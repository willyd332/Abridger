import { z } from 'zod'

import { DEFAULT_LLM_CONCURRENCY, createLimit } from '@/lib/concurrency'
import type { LLMClient } from '@/llm/client'
import { parseLlmJsonOrThrow } from '@/llm/parse-json'
import { getPrompt } from '@/llm/prompts/loader'

import { buildTitleChain } from './inclusion'
import type { Emit } from '../types'
import type { NodeSummary, OntologyNode, OntologyTree } from './types'

export const PHASE_S_LEAF_NAME = 'S-leaf'
export const PHASE_S_INTERNAL_NAME = 'S-internal'

const summarizeResponseSchema = z.object({
  summary: z.string().min(20),
  wordCount: z.number().int().optional(),
})

export type PhaseSOptions = {
  emit?: Emit
  signal?: AbortSignal
  concurrency?: number
  bookText: string
}

function placeholderSummary(text: string): NodeSummary {
  return {
    text,
    wordCount: text.split(/\s+/).filter(Boolean).length,
    generatedAt: Date.now(),
  }
}

function sampleSentences(text: string, count: number): string[] {
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

async function summarizeLeaf(
  tree: OntologyTree,
  node: OntologyNode,
  bookText: string,
  client: LLMClient,
  opts: { emit?: Emit; signal?: AbortSignal },
): Promise<NodeSummary> {
  const prompt = getPrompt('ontology-summarize-leaf')
  const chain = buildTitleChain(tree, node.id).join(' › ')
  const leafText = bookText.slice(node.startOffset, node.endOffset)

  // Guard: empty / trivially-short content makes Anthropic return a 400
  // ("content blocks must be non-empty"). Synthesize a placeholder summary
  // for these (e.g. all-folio pages) instead of calling the API.
  if (leafText.trim().length < 80) {
    return {
      text: `${node.title} — too little body text to summarize (${leafText.trim().length} characters).`,
      wordCount: 12,
      generatedAt: Date.now(),
    }
  }

  for (const sentence of sampleSentences(leafText, 10)) {
    opts.emit?.({
      kind: 'phase-sample',
      phase: PHASE_S_LEAF_NAME,
      source: 'book',
      text: sentence,
      sectionId: node.id,
    })
  }

  const baseUser = (force: boolean): string =>
    [
      `Title chain: ${chain}`,
      `Pages: ${node.startPage ?? '?'}–${node.endPage ?? '?'}`,
      'Produce a 60–120 word neutral-descriptive summary that preserves proper nouns, dates, named theories, and rhetorical moves.',
      'Return JSON: {"summary":"…","wordCount":<int>}',
      force
        ? '\nRETRY: the previous attempt failed to parse. Return ONLY a single JSON object with a non-empty `summary` string at least 20 characters long. No prose before or after the JSON. No markdown fences.'
        : '',
    ]
      .filter(Boolean)
      .join('\n')

  const attempt = async (
    force: boolean,
    suffix: string,
  ): Promise<NodeSummary | null> => {
    const result = await client.callWithBookContent({
      role: prompt.meta.role,
      temperature: prompt.meta.temperature,
      responseFormat: prompt.meta.responseFormat === 'json' ? { jsonSchema: {} } : 'text',
      maxTokens: prompt.meta.maxTokens,
      system: prompt.body,
      user: baseUser(force),
      bookContent: leafText,
      signal: opts.signal,
      metadata: {
        phase: PHASE_S_LEAF_NAME,
        sectionId: node.id,
        requestId: `phaseS-leaf-${node.id}${suffix}`,
      },
    })
    if (!result.ok) {
      // eslint-disable-next-line no-console
      console.warn('[summarize-leaf] call failed', {
        nodeId: node.id,
        errorKind: result.error.kind,
        attemptSuffix: suffix,
      })
      return null
    }
    try {
      const parsed = summarizeResponseSchema.parse(parseLlmJsonOrThrow(result.data))
      for (const sentence of sampleSentences(parsed.summary, 5)) {
        opts.emit?.({
          kind: 'phase-sample',
          phase: PHASE_S_LEAF_NAME,
          source: 'reasoning',
          text: sentence,
          sectionId: node.id,
        })
      }
      opts.emit?.({
        kind: 'tree-node',
        phase: PHASE_S_LEAF_NAME,
        nodeId: node.id,
        parentId: node.parentId,
        depth: node.depth,
        title: node.title,
        isLeaf: true,
        summarized: true,
      })
      return {
        text: parsed.summary,
        wordCount:
          parsed.wordCount ?? parsed.summary.split(/\s+/).filter(Boolean).length,
        generatedAt: Date.now(),
      }
    } catch (err) {
      const rawPreview =
        typeof result.data === 'string' ? result.data.slice(0, 300) : ''
      // eslint-disable-next-line no-console
      console.warn('[summarize-leaf] parse failed', {
        nodeId: node.id,
        attemptSuffix: suffix,
        error: err instanceof Error ? err.message : String(err),
        rawPreview,
      })
      return null
    }
  }

  // First pass — standard prompt.
  const first = await attempt(false, '')
  if (first) return first

  // Second pass — explicit "JSON only, no prose" reminder. Most parse
  // failures are the model emitting prose around the JSON.
  const second = await attempt(true, '-retry')
  if (second) return second

  opts.emit?.({
    kind: 'phase-warning',
    phase: PHASE_S_LEAF_NAME,
    warning: `Leaf summary failed twice for ${node.id}; using placeholder.`,
    sectionId: node.id,
  })
  return placeholderSummary(
    `[Summary unavailable after retry. Passage covers pages ${node.startPage ?? '?'}–${node.endPage ?? '?'}.]`,
  )
}

async function summarizeInternal(
  tree: OntologyTree,
  node: OntologyNode,
  childrenSummaries: Array<{ title: string; summary: string }>,
  client: LLMClient,
  opts: { emit?: Emit; signal?: AbortSignal },
): Promise<NodeSummary> {
  const prompt = getPrompt('ontology-summarize-internal')
  const chain = buildTitleChain(tree, node.id).join(' › ')
  const childrenBlock = childrenSummaries
    .map((c, i) => `${i + 1}. "${c.title}" — ${c.summary}`)
    .join('\n')

  const baseUser = (force: boolean): string =>
    [
      `Title chain: ${chain}`,
      `Pages: ${node.startPage ?? '?'}–${node.endPage ?? '?'}`,
      'Synthesize the children below into a 100–250 word description of the through-line of this node. Do not enumerate them mechanically.',
      'Return JSON: {"summary":"…","wordCount":<int>}',
      '',
      'Children:',
      childrenBlock,
      force
        ? '\nRETRY: the previous attempt failed to parse. Return ONLY a single JSON object with a non-empty `summary` string at least 20 characters long. No prose before or after the JSON. No markdown fences.'
        : '',
    ]
      .filter(Boolean)
      .join('\n')

  const attempt = async (
    force: boolean,
    suffix: string,
  ): Promise<NodeSummary | null> => {
    const result = await client.callWithBookContent({
      role: prompt.meta.role,
      temperature: prompt.meta.temperature,
      responseFormat: prompt.meta.responseFormat === 'json' ? { jsonSchema: {} } : 'text',
      maxTokens: prompt.meta.maxTokens,
      system: prompt.body,
      user: baseUser(force),
      bookContent: childrenBlock,
      signal: opts.signal,
      metadata: {
        phase: PHASE_S_INTERNAL_NAME,
        sectionId: node.id,
        requestId: `phaseS-internal-${node.id}${suffix}`,
      },
    })
    if (!result.ok) {
      // eslint-disable-next-line no-console
      console.warn('[summarize-internal] call failed', {
        nodeId: node.id,
        errorKind: result.error.kind,
        attemptSuffix: suffix,
      })
      return null
    }
    try {
      const parsed = summarizeResponseSchema.parse(parseLlmJsonOrThrow(result.data))
      for (const sentence of sampleSentences(parsed.summary, 5)) {
        opts.emit?.({
          kind: 'phase-sample',
          phase: PHASE_S_INTERNAL_NAME,
          source: 'reasoning',
          text: sentence,
          sectionId: node.id,
        })
      }
      opts.emit?.({
        kind: 'tree-node',
        phase: PHASE_S_INTERNAL_NAME,
        nodeId: node.id,
        parentId: node.parentId,
        depth: node.depth,
        title: node.title,
        isLeaf: false,
        summarized: true,
      })
      return {
        text: parsed.summary,
        wordCount:
          parsed.wordCount ?? parsed.summary.split(/\s+/).filter(Boolean).length,
        generatedAt: Date.now(),
      }
    } catch (err) {
      const rawPreview =
        typeof result.data === 'string' ? result.data.slice(0, 300) : ''
      // eslint-disable-next-line no-console
      console.warn('[summarize-internal] parse failed', {
        nodeId: node.id,
        attemptSuffix: suffix,
        error: err instanceof Error ? err.message : String(err),
        rawPreview,
      })
      return null
    }
  }

  const first = await attempt(false, '')
  if (first) return first
  const second = await attempt(true, '-retry')
  if (second) return second

  opts.emit?.({
    kind: 'phase-warning',
    phase: PHASE_S_INTERNAL_NAME,
    warning: `Internal summary failed twice for ${node.id}; using fallback.`,
    sectionId: node.id,
  })
  const fallback = childrenSummaries.map((c) => c.title).join('; ')
  return placeholderSummary(`This node covers: ${fallback}.`)
}

function groupByDepthAscending(tree: OntologyTree): OntologyNode[][] {
  // Bottom-up = deepest first
  const byDepth = new Map<number, OntologyNode[]>()
  for (const id of Object.keys(tree.nodes)) {
    const node = tree.nodes[id]
    const bucket = byDepth.get(node.depth) ?? []
    bucket.push(node)
    byDepth.set(node.depth, bucket)
  }
  const depths = [...byDepth.keys()].sort((a, b) => b - a)
  return depths.map((d) => byDepth.get(d)!)
}

export type PhaseSResult = {
  tree: OntologyTree
  leavesSummarized: number
  internalSummarized: number
}

export async function summarizeOntology(
  tree: OntologyTree,
  client: LLMClient,
  opts: PhaseSOptions,
): Promise<PhaseSResult> {
  const emit = opts.emit
  const concurrency = opts.concurrency ?? DEFAULT_LLM_CONCURRENCY
  const limit = createLimit(concurrency)

  const layers = groupByDepthAscending(tree)
  const allLeafIds = new Set(tree.leafIdsInOrder)
  const allInternalNonRoot = Object.values(tree.nodes).filter(
    (n) => !n.isLeaf,
  ).length
  const total = allLeafIds.size + allInternalNonRoot

  let completed = 0
  let leavesSummarized = 0
  let internalSummarized = 0

  emit?.({ kind: 'phase-start', phase: PHASE_S_LEAF_NAME })

  // Mutable accumulator: we copy tree.nodes and patch as we go.
  let nodes: Record<string, OntologyNode> = { ...tree.nodes }

  for (const layer of layers) {
    if (opts.signal?.aborted) break
    const leavesInLayer = layer.filter((n) => allLeafIds.has(n.id))
    const internalsInLayer = layer.filter((n) => !n.isLeaf)

    if (leavesInLayer.length > 0) {
      const settled = await Promise.all(
        leavesInLayer.map((node) =>
          limit(async () => {
            const summary = await summarizeLeaf(
              { ...tree, nodes },
              node,
              opts.bookText,
              client,
              { emit, signal: opts.signal },
            )
            return { id: node.id, summary }
          }),
        ),
      )
      for (const { id, summary } of settled) {
        nodes = { ...nodes, [id]: { ...nodes[id], summary } }
        leavesSummarized += 1
        completed += 1
      }
      emit?.({
        kind: 'phase-progress',
        phase: PHASE_S_LEAF_NAME,
        completed,
        total,
      })
    }

    if (internalsInLayer.length > 0) {
      const settled = await Promise.all(
        internalsInLayer.map((node) =>
          limit(async () => {
            const childSummaries = node.childIds.map((cid) => {
              const child = nodes[cid]
              return {
                title: child?.title ?? 'Untitled',
                summary: child?.summary?.text ?? '[Summary unavailable.]',
              }
            })
            const summary = await summarizeInternal(
              { ...tree, nodes },
              node,
              childSummaries,
              client,
              { emit, signal: opts.signal },
            )
            return { id: node.id, summary }
          }),
        ),
      )
      for (const { id, summary } of settled) {
        nodes = { ...nodes, [id]: { ...nodes[id], summary } }
        internalSummarized += 1
        completed += 1
      }
      emit?.({
        kind: 'phase-progress',
        phase: PHASE_S_INTERNAL_NAME,
        completed,
        total,
      })
    }
  }

  emit?.({ kind: 'phase-end', phase: PHASE_S_LEAF_NAME, durationMs: 0 })
  return {
    tree: { ...tree, nodes },
    leavesSummarized,
    internalSummarized,
  }
}

export const __test__ = {
  groupByDepthAscending,
}
