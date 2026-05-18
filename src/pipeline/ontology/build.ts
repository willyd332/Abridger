import { z } from 'zod'

import { createLimit } from '@/lib/concurrency'
import type { LLMClient } from '@/llm/client'
import { parseLlmJsonOrThrow } from '@/llm/parse-json'
import { getPrompt } from '@/llm/prompts/loader'
import type { ParsedBook } from '@/parsers/types'

import type { OutlineNode } from '../phaseA-structure'
import type { Emit } from '../types'

import {
  LEAF_BYTE_BUDGET,
  LEAF_PAGE_BUDGET,
  MAX_CHILDREN_PER_NODE,
  MAX_TREE_DEPTH,
  MIN_CHILD_BYTES,
  MIN_CHILD_PAGES,
  type OntologyNode,
  type OntologyTree,
} from './types'

export const PHASE_O_NAME = 'O-ontology'
export const DECOMPOSE_CONCURRENCY = 4

const childSchema = z.object({
  title: z.string().min(1).max(160),
  startOffset: z.number().int().min(0),
  endOffset: z.number().int().min(1).optional(),
  rationale: z.string().optional(),
})

const decomposeResponseSchema = z.object({
  children: z.array(childSchema).min(1),
})

// Given the LLM's (possibly endOffset-less) children + parent text length,
// fill in endOffset values from the next child's startOffset (last child
// runs to parent end). Used before reconcileChildren.
function fillEndOffsets(
  proposed: Array<{ title: string; startOffset: number; endOffset?: number }>,
  parentLength: number,
): RawChild[] {
  if (proposed.length === 0) return []
  const sorted = [...proposed].sort((a, b) => a.startOffset - b.startOffset)
  const out: RawChild[] = []
  for (let i = 0; i < sorted.length; i += 1) {
    const c = sorted[i]
    const next = sorted[i + 1]
    const end =
      c.endOffset !== undefined && c.endOffset > c.startOffset
        ? c.endOffset
        : next
          ? next.startOffset
          : parentLength
    out.push({
      title: c.title,
      startOffset: c.startOffset,
      endOffset: end,
    })
  }
  return out
}

export type PhaseOOptions = {
  emit?: Emit
  signal?: AbortSignal
  concurrency?: number
  leafByteBudget?: number
  leafPageBudget?: number
  maxDepth?: number
}

type PageIndex = {
  // pageStarts[i] = char offset in rawText where page (i+1) begins
  pageStarts: number[]
  lastPage: number
}

export function buildPageIndex(parsedBook: ParsedBook): PageIndex {
  const pageStarts: number[] = []
  let offset = 0
  for (const page of parsedBook.pages) {
    pageStarts[page.number - 1] = offset
    const text = page.blocks
      .filter((b) => b.classification === 'body')
      .map((b) => b.text)
      .join('\n')
    offset += text.length + 1
  }
  return {
    pageStarts,
    lastPage: parsedBook.pages[parsedBook.pages.length - 1]?.number ?? 1,
  }
}

export function offsetToPage(index: PageIndex, offset: number): number {
  if (index.pageStarts.length === 0) return 1
  let lo = 0
  let hi = index.pageStarts.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1
    if (index.pageStarts[mid] <= offset) lo = mid
    else hi = mid - 1
  }
  return lo + 1
}

type RawChild = {
  title: string
  startOffset: number
  endOffset: number
}

// Reconcile child offsets:
// - sort by startOffset
// - clamp to parent range
// - snap each boundary to nearest paragraph break (double-newline) within ±400 chars
// - ensure contiguous coverage by filling gaps with the next child's start
// - drop overlaps
// - cap to MAX_CHILDREN; if longer, merge into 'Remaining material' tail
function reconcileChildren(
  proposed: RawChild[],
  parentText: string,
): RawChild[] {
  const sorted = [...proposed]
    .filter((c) => Number.isFinite(c.startOffset) && Number.isFinite(c.endOffset))
    .map((c) => ({
      title: c.title.trim() || 'Untitled section',
      startOffset: Math.max(0, Math.min(parentText.length, Math.floor(c.startOffset))),
      endOffset: Math.max(0, Math.min(parentText.length, Math.floor(c.endOffset))),
    }))
    .filter((c) => c.endOffset > c.startOffset)
    .sort((a, b) => a.startOffset - b.startOffset)

  if (sorted.length === 0) return []

  // Snap interior boundaries to paragraph breaks. Boundaries are derived
  // from the LLM's startOffset values (one boundary between each child);
  // overlaps cannot occur because fillEndOffsets sets each child's endOffset
  // to the next child's startOffset (or parent length for the last child).
  const snapped: RawChild[] = []
  for (let i = 0; i < sorted.length; i += 1) {
    const c = sorted[i]
    const prev = snapped[snapped.length - 1]
    const start = i === 0 ? 0 : prev.endOffset
    const requestedEnd = c.endOffset
    const end =
      i === sorted.length - 1
        ? parentText.length
        : snapToParagraph(parentText, requestedEnd)
    if (end <= start) continue
    snapped.push({ title: c.title, startOffset: start, endOffset: end })
  }
  if (snapped.length === 0) return []
  snapped[snapped.length - 1] = {
    ...snapped[snapped.length - 1],
    endOffset: parentText.length,
  }

  // Cap to MAX_CHILDREN
  if (snapped.length > MAX_CHILDREN_PER_NODE) {
    const kept = snapped.slice(0, MAX_CHILDREN_PER_NODE - 1)
    const tail: RawChild = {
      title: 'Remaining material',
      startOffset: kept[kept.length - 1].endOffset,
      endOffset: parentText.length,
    }
    return [...kept, tail]
  }
  return snapped
}

// Merge any child spanning fewer than `minPages` pages into its predecessor
// (or into its successor if it has no predecessor). Children carry
// parent-local offsets; pages come from the parent-relative-to-book offset
// + the global page index. After merging, every output child spans at
// least `minPages` pages — except in the degenerate case where the entire
// parent itself spans fewer pages, in which case the merge collapses to a
// single child and the BFS loop marks the parent as a leaf.
function mergeUndersizedByPages(
  children: RawChild[],
  parentStartOffset: number,
  pageIndex: PageIndex,
  minPages: number,
): RawChild[] {
  if (children.length <= 1) return children
  const pageCountOf = (c: RawChild): number => {
    const startAbs = parentStartOffset + c.startOffset
    const endAbs = parentStartOffset + Math.max(c.startOffset + 1, c.endOffset)
    const sp = offsetToPage(pageIndex, startAbs)
    const ep = offsetToPage(pageIndex, endAbs - 1)
    return Math.max(1, ep - sp + 1)
  }
  const out: RawChild[] = []
  for (const c of children) {
    if (out.length === 0) {
      out.push(c)
      continue
    }
    const prev = out[out.length - 1]
    if (pageCountOf(c) < minPages) {
      // Merge c into prev — extend prev's range, keep prev's title.
      out[out.length - 1] = {
        title: prev.title,
        startOffset: prev.startOffset,
        endOffset: c.endOffset,
      }
      continue
    }
    // If prev is itself undersized, absorb prev into c by extending c's
    // start backwards. Keeps c's title (more descriptive of the larger span).
    if (pageCountOf(prev) < minPages) {
      out[out.length - 1] = {
        title: c.title,
        startOffset: prev.startOffset,
        endOffset: c.endOffset,
      }
      continue
    }
    out.push(c)
  }
  // Last-pass: if the final element is still under floor, merge into its predecessor.
  if (out.length >= 2) {
    const last = out[out.length - 1]
    if (pageCountOf(last) < minPages) {
      const beforeLast = out[out.length - 2]
      out.splice(out.length - 2, 2, {
        title: beforeLast.title,
        startOffset: beforeLast.startOffset,
        endOffset: last.endOffset,
      })
    }
  }
  return out
}

function snapToParagraph(text: string, offset: number): number {
  const window = 400
  const lo = Math.max(0, offset - window)
  const hi = Math.min(text.length, offset + window)
  let best = offset
  let bestDist = Number.POSITIVE_INFINITY
  for (let i = lo; i < hi; i += 1) {
    if (text[i] === '\n' && text[i + 1] === '\n') {
      const dist = Math.abs(i - offset)
      if (dist < bestDist) {
        bestDist = dist
        best = i + 2
      }
    }
  }
  return best
}

function sampleSentences(text: string, count: number): string[] {
  // Pull `count` roughly-distinct sentence-shaped slices from the text for
  // the live cascade UI. Cheap heuristic: split on terminal punctuation,
  // filter sub-25-char shards, pick evenly spaced.
  const candidates = text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 25 && s.length <= 240)
  if (candidates.length === 0) return []
  if (candidates.length <= count) return candidates.slice(0, count)
  const out: string[] = []
  for (let i = 0; i < count; i += 1) {
    const idx = Math.floor((i + 0.5) * (candidates.length / count))
    out.push(candidates[Math.min(candidates.length - 1, idx)])
  }
  return out
}

function annotateOffsets(text: string, step = 1000): string {
  if (text.length < step) return text
  const parts: string[] = []
  for (let i = 0; i < text.length; i += step) {
    parts.push(`[OFFSET=${i}]`)
    parts.push(text.slice(i, Math.min(text.length, i + step)))
  }
  return parts.join('')
}

function titleChainFor(
  nodes: Record<string, OntologyNode>,
  nodeId: string,
): string {
  const chain: string[] = []
  let current: string | null = nodeId
  while (current) {
    const node: OntologyNode | undefined = nodes[current]
    if (!node) break
    chain.unshift(node.title)
    current = node.parentId
  }
  return chain.join(' › ')
}

function makeNodeId(counter: { n: number }): string {
  counter.n += 1
  return `node-${String(counter.n).padStart(4, '0')}`
}

async function decomposeOne(
  parent: OntologyNode,
  parentText: string,
  tocHint: OutlineNode[] | null,
  titleChain: string,
  client: LLMClient,
  opts: { emit?: Emit; signal?: AbortSignal; force?: boolean },
): Promise<RawChild[]> {
  // Guard against empty / trivially-short content. Anthropic returns a 400
  // when the content block contains only whitespace. If the parent has no
  // meaningful body text (e.g. a section of the book where every page was
  // classified as non-body — folios, blank pages, image-only), there's
  // nothing to decompose; accept it as a leaf.
  if (parentText.trim().length < 200) {
    opts.emit?.({
      kind: 'phase-warning',
      phase: PHASE_O_NAME,
      warning: `Skipping decomposition for ${parent.id}: too little body text (${parentText.trim().length} chars).`,
      sectionId: parent.id,
    })
    return []
  }
  const prompt = getPrompt('ontology-decompose')
  const annotatedText = annotateOffsets(parentText)
  const tocLines = (tocHint ?? [])
    .map((n) => `- "${n.title}" (starting page ${n.startPage})`)
    .join('\n')
    .trim()

  // Emit sample sentences from the parent text for the live cascade
  for (const sentence of sampleSentences(parentText, 15)) {
    opts.emit?.({
      kind: 'phase-sample',
      phase: PHASE_O_NAME,
      source: 'book',
      text: sentence,
      sectionId: parent.id,
    })
  }

  const forceLines = opts.force
    ? [
        '',
        'IMPORTANT — RETRY: An earlier pass produced no usable sub-structure for this passage. Look harder. Even continuous expository prose has rhetorical moves — opening setup, central argument, supporting evidence, objections, conclusion. Identify at least 2 named subtopics; an even split is acceptable if no natural break stands out. Do not return a single child equal to the whole passage on this attempt.',
      ]
    : []

  const user = [
    `Parent title chain: ${titleChain}`,
    `Parent byte size: ${parentText.length} characters`,
    `Reading-order position: pages ${parent.startPage ?? '?'}–${parent.endPage ?? '?'}`,
    `Decompose into 3–8 contiguous children with descriptive titles.`,
    `Each child's startOffset is relative to 0 (start of parent text). The last child's endOffset must equal ${parentText.length}.`,
    tocLines ? `TOC hint (suggestive only):\n${tocLines}` : 'TOC hint: none.',
    ...forceLines,
  ].join('\n')

  const result = await client.callWithBookContent({
    role: prompt.meta.role,
    temperature: prompt.meta.temperature,
    responseFormat: prompt.meta.responseFormat === 'json' ? { jsonSchema: {} } : 'text',
    maxTokens: prompt.meta.maxTokens,
    system: prompt.body,
    user,
    bookContent: annotatedText,
    signal: opts.signal,
    metadata: {
      phase: PHASE_O_NAME,
      sectionId: parent.id,
      requestId: `phaseO-decompose-${parent.id}`,
    },
  })

  if (!result.ok) {
    opts.emit?.({
      kind: 'phase-warning',
      phase: PHASE_O_NAME,
      warning: `Decomposition failed for node ${parent.id}: ${result.error.kind}; treating as leaf`,
      sectionId: parent.id,
    })
    return []
  }

  try {
    const parsed = decomposeResponseSchema.parse(parseLlmJsonOrThrow(result.data))
    for (const child of parsed.children) {
      opts.emit?.({
        kind: 'phase-sample',
        phase: PHASE_O_NAME,
        source: 'reasoning',
        text: child.title,
        sectionId: parent.id,
      })
    }
    const filled = fillEndOffsets(parsed.children, parentText.length)
    return reconcileChildren(filled, parentText)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    opts.emit?.({
      kind: 'phase-warning',
      phase: PHASE_O_NAME,
      warning: `Decomposition JSON invalid for node ${parent.id}: ${message}; treating as leaf`,
      sectionId: parent.id,
    })
    return []
  }
}

function seedTopLevel(
  outline: OutlineNode[] | null,
  bookText: string,
  pageIndex: PageIndex,
): RawChild[] {
  if (!outline || outline.length === 0) return []
  const lastPage = pageIndex.lastPage
  const flat = outline
    .map((n) => ({
      title: n.title,
      startPage: Math.max(1, Math.min(lastPage, n.startPage)),
    }))
    .sort((a, b) => a.startPage - b.startPage)
  if (flat.length === 0) return []

  const children: RawChild[] = []
  for (let i = 0; i < flat.length; i += 1) {
    const entry = flat[i]
    const next = flat[i + 1]
    const startOffset = pageIndex.pageStarts[entry.startPage - 1] ?? 0
    const endOffset = next
      ? pageIndex.pageStarts[next.startPage - 1] ?? bookText.length
      : bookText.length
    if (endOffset <= startOffset) continue
    children.push({ title: entry.title, startOffset, endOffset })
  }
  // Snap to paragraphs and merge tiny seeds (< MIN_CHILD_BYTES) into next sibling
  const merged: RawChild[] = []
  for (const c of children) {
    const last = merged[merged.length - 1]
    if (last && c.endOffset - c.startOffset < MIN_CHILD_BYTES) {
      merged[merged.length - 1] = {
        title: last.title,
        startOffset: last.startOffset,
        endOffset: c.endOffset,
      }
      continue
    }
    merged.push(c)
  }
  // Ensure coverage of the whole book by extending first/last
  if (merged.length > 0) {
    merged[0] = { ...merged[0], startOffset: 0 }
    merged[merged.length - 1] = {
      ...merged[merged.length - 1],
      endOffset: bookText.length,
    }
  }
  return merged
}

export type PhaseOInput = {
  parsedBook: ParsedBook
  outline: OutlineNode[] | null
}

export async function buildOntology(
  input: PhaseOInput,
  client: LLMClient,
  opts: PhaseOOptions = {},
): Promise<OntologyTree> {
  const start = Date.now()
  const emit = opts.emit
  const concurrency = opts.concurrency ?? DECOMPOSE_CONCURRENCY
  // leafBudget retained for legacy options compatibility; the active budget
  // is now page-based via leafPageBudget.
  void (opts.leafByteBudget ?? LEAF_BYTE_BUDGET)
  const leafPageBudget = opts.leafPageBudget ?? LEAF_PAGE_BUDGET
  const maxDepth = opts.maxDepth ?? MAX_TREE_DEPTH

  emit?.({ kind: 'phase-start', phase: PHASE_O_NAME })

  const { parsedBook, outline } = input
  const bookText = parsedBook.rawText
  const pageIndex = buildPageIndex(parsedBook)
  const counter = { n: 0 }
  const nodes: Record<string, OntologyNode> = {}

  const rootId = makeNodeId(counter)
  const root: OntologyNode = {
    id: rootId,
    parentId: null,
    childIds: [],
    order: 0,
    depth: 0,
    title: parsedBook.title?.trim() || 'Book',
    startOffset: 0,
    endOffset: bookText.length,
    startPage: 1,
    endPage: pageIndex.lastPage,
    isLeaf: false,
    source: 'root',
    summary: null,
  }
  nodes[rootId] = root
  emit?.({
    kind: 'tree-node',
    phase: PHASE_O_NAME,
    nodeId: rootId,
    parentId: null,
    depth: 0,
    title: root.title,
    isLeaf: false,
  })

  const seeded = seedTopLevel(outline, bookText, pageIndex)
  if (seeded.length > 0) {
    for (let i = 0; i < seeded.length; i += 1) {
      const child = seeded[i]
      const id = makeNodeId(counter)
      const node: OntologyNode = {
        id,
        parentId: rootId,
        childIds: [],
        order: i,
        depth: 1,
        title: child.title,
        startOffset: child.startOffset,
        endOffset: child.endOffset,
        startPage: offsetToPage(pageIndex, child.startOffset),
        endPage: offsetToPage(pageIndex, child.endOffset - 1),
        isLeaf: false,
        source: 'toc',
        summary: null,
      }
      nodes[id] = node
      nodes[rootId] = { ...nodes[rootId], childIds: [...nodes[rootId].childIds, id] }
      emit?.({
        kind: 'tree-node',
        phase: PHASE_O_NAME,
        nodeId: id,
        parentId: rootId,
        depth: 1,
        title: child.title,
        isLeaf: false,
      })
    }
  }
  // Guard: a 1-child seed (i.e., Phase A produced only "Book → Untitled") is
  // not a usable starting point — it forces Phase O to recurse on the entire
  // book in one decomp call, which routinely fails. If we only have ≤ 1 seed
  // here, surface a clean error rather than silently producing a single
  // mega-leaf.
  if (
    seeded.length === 1 &&
    seeded[0].endOffset - seeded[0].startOffset === bookText.length
  ) {
    emit?.({
      kind: 'phase-error',
      phase: PHASE_O_NAME,
      error:
        'Structure detection produced only one section spanning the whole book. ' +
        'This indicates Phase A LLM windowing failed or rate-limited. Retry the run.',
    })
    throw new Error('buildOntology: only one seed covers the whole book')
  }

  // If we didn't get TOC seeds, root will be decomposed by the LLM as a single
  // top-level call.

  // BFS by depth so we can run sibling decompositions in parallel.
  const queue: string[] = nodes[rootId].childIds.length > 0 ? [...nodes[rootId].childIds] : [rootId]
  const limit = createLimit(concurrency)

  let totalDecomposed = 0
  let totalLeavesSoFar = 0

  while (queue.length > 0) {
    if (opts.signal?.aborted) break
    const layer = queue.splice(0, queue.length)
    const needsDecomp: string[] = []
    for (const id of layer) {
      const node = nodes[id]
      const sizeBytes = node.endOffset - node.startOffset
      const pageCount =
        node.startPage && node.endPage
          ? node.endPage - node.startPage + 1
          : Math.ceil(sizeBytes / 2500) // fallback when pages aren't known
      // Leaf if: at max depth, OR within page budget, OR too tiny to subdivide.
      const isLeafByPages = pageCount <= leafPageBudget
      const isLeafByMaxDepth = node.depth >= maxDepth
      const isLeafTooSmall = sizeBytes < MIN_CHILD_BYTES
      if (isLeafByMaxDepth || isLeafByPages || isLeafTooSmall) {
        nodes[id] = { ...node, isLeaf: true }
        totalLeavesSoFar += 1
        continue
      }
      needsDecomp.push(id)
    }
    if (needsDecomp.length === 0) continue

    const results = await Promise.all(
      needsDecomp.map((id) =>
        limit(async () => {
          const node = nodes[id]
          const parentText = bookText.slice(node.startOffset, node.endOffset)
          const chain = titleChainFor(nodes, id)
          const children = await decomposeOne(
            node,
            parentText,
            null,
            chain,
            client,
            { emit, signal: opts.signal },
          )
          return { id, children, parentText }
        }),
      ),
    )

    // Retry any nodes whose first decomposition returned ≤ 1 child. This
    // distinguishes a real "this passage doesn't subdivide" verdict from a
    // transient call failure / parse failure / overly-conservative model.
    const retryIds = results
      .filter((r) => r.children.length <= 1)
      .map((r) => r.id)
    const retryMap = new Map<string, RawChild[]>()
    if (retryIds.length > 0) {
      const retries = await Promise.all(
        retryIds.map((id) =>
          limit(async () => {
            const node = nodes[id]
            const parentText = bookText.slice(node.startOffset, node.endOffset)
            const chain = titleChainFor(nodes, id)
            const children = await decomposeOne(
              node,
              parentText,
              null,
              chain,
              client,
              { emit, signal: opts.signal, force: true },
            )
            return { id, children }
          }),
        ),
      )
      for (const r of retries) retryMap.set(r.id, r.children)
    }

    for (const { id, children } of results) {
      const node = nodes[id]
      const rawChildren = retryMap.get(id) ?? children
      if (rawChildren.length <= 1) {
        // Both passes agree the passage doesn't usefully subdivide. Accept
        // as a leaf with its existing (real, LLM-given) title. Phase S will
        // try to summarize it; if context overflow occurs, it emits a
        // placeholder summary and the leaf still appears named in the tree.
        nodes[id] = { ...node, isLeaf: true, source: 'forced-leaf' }
        totalLeavesSoFar += 1
        continue
      }
      // Merge children that span fewer than MIN_CHILD_PAGES pages into a
      // sibling. Prevents 1–2 page "subtopics" from landing as leaves —
      // every leaf in the final tree is at least MIN_CHILD_PAGES pages.
      const effectiveChildren = mergeUndersizedByPages(
        rawChildren,
        node.startOffset,
        pageIndex,
        MIN_CHILD_PAGES,
      )
      if (effectiveChildren.length <= 1) {
        nodes[id] = { ...node, isLeaf: true, source: 'forced-leaf' }
        totalLeavesSoFar += 1
        continue
      }
      // Build child OntologyNodes
      const childIds: string[] = []
      for (let i = 0; i < effectiveChildren.length; i += 1) {
        const c = effectiveChildren[i]
        const childStart = node.startOffset + c.startOffset
        const childEnd = node.startOffset + c.endOffset
        if (childEnd <= childStart) continue
        const childId = makeNodeId(counter)
        const childNode: OntologyNode = {
          id: childId,
          parentId: id,
          childIds: [],
          order: i,
          depth: node.depth + 1,
          title: c.title,
          startOffset: childStart,
          endOffset: childEnd,
          startPage: offsetToPage(pageIndex, childStart),
          endPage: offsetToPage(pageIndex, Math.max(childStart, childEnd - 1)),
          isLeaf: false,
          source: 'llm-decomposed',
          summary: null,
        }
        nodes[childId] = childNode
        childIds.push(childId)
        emit?.({
          kind: 'tree-node',
          phase: PHASE_O_NAME,
          nodeId: childId,
          parentId: id,
          depth: childNode.depth,
          title: childNode.title,
          isLeaf: false,
        })
      }
      nodes[id] = { ...node, childIds }
      totalDecomposed += 1
      // Enqueue children for next layer
      queue.push(...childIds)
    }

    emit?.({
      kind: 'phase-progress',
      phase: PHASE_O_NAME,
      completed: totalDecomposed,
      total: totalDecomposed + queue.length,
    })
  }

  // Anything left in the queue when aborted should be marked as leaf
  for (const id of queue) {
    if (nodes[id] && !nodes[id].isLeaf) {
      nodes[id] = { ...nodes[id], isLeaf: true, source: 'forced-leaf' }
    }
  }

  const leafIdsInOrder = collectLeavesInReadingOrder(nodes, rootId)
  const tree: OntologyTree = {
    rootId,
    nodes,
    leafIdsInOrder,
    totalChars: bookText.length,
    builtAt: Date.now(),
  }
  emit?.({
    kind: 'phase-end',
    phase: PHASE_O_NAME,
    durationMs: Date.now() - start,
  })
  return tree
}

function collectLeavesInReadingOrder(
  nodes: Record<string, OntologyNode>,
  rootId: string,
): string[] {
  const out: string[] = []
  const stack: string[] = [rootId]
  while (stack.length) {
    const id = stack.pop()!
    const node = nodes[id]
    if (!node) continue
    if (node.isLeaf) {
      out.push(id)
    } else {
      // Push reversed so order is preserved
      for (let i = node.childIds.length - 1; i >= 0; i -= 1) stack.push(node.childIds[i])
    }
  }
  return out
}

export const __test__ = {
  reconcileChildren,
  snapToParagraph,
  seedTopLevel,
  buildPageIndex,
  offsetToPage,
  collectLeavesInReadingOrder,
}
