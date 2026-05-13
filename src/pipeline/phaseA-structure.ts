import { z } from 'zod'

import { DEFAULT_LLM_CONCURRENCY, mapWithLimit } from '@/lib/concurrency'
import { LLMClient } from '@/llm/client'
import { getPrompt } from '@/llm/prompts/loader'
import type { Block, Page, ParsedBook } from '@/parsers/types'

import type { Emit, Section, SectionSource } from './types'

const DEFAULT_WINDOW_PAGES = 10
const DEFAULT_LLM_CROSS_CHECK_SAMPLE_RATE = 0.1
const HYBRID_DISAGREEMENT_RATIO = 0.3
const BOUNDARY_TOLERANCE_PAGES = 2
const LOW_CONFIDENCE_THRESHOLD = 0.4
const SPINE_TOKEN_BUDGET = 30000
const CHARS_PER_TOKEN_HEURISTIC = 4
const BOUNDARY_DEDUPE_PAGES = 2
const PHASE_NAME = 'A-structure'

export type OutlineNode = {
  title: string
  startPage: number
  endPage?: number
  children?: OutlineNode[]
}

export type PhaseAOptions = {
  emit?: Emit
  signal?: AbortSignal
  windowPages?: number
  llmCrossCheckSampleRate?: number
  outline?: OutlineNode[] | null
  spineTokenBudget?: number
}

export type PhaseAResult = {
  sections: Section[]
  source: SectionSource | 'hybrid'
  warnings: string[]
}

const boundarySchema = z.object({
  boundaryPageNumber: z.number().int().min(1),
  suggestedTitle: z.string().min(1),
  confidence: z.number().min(0).max(1),
})

const structureResponseSchema = z.object({
  boundaries: z.array(boundarySchema),
})

type Boundary = z.infer<typeof boundarySchema>

function makeSectionId(order: number, title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return `sec-${String(order).padStart(3, '0')}-${slug || 'untitled'}`
}

function blocksInPageRange(pages: Page[], startPage: number, endPage: number): Block[] {
  const out: Block[] = []
  for (const page of pages) {
    if (page.number < startPage || page.number > endPage) continue
    for (const block of page.blocks) out.push(block)
  }
  return out
}

function bodyTextFor(blocks: Block[]): string {
  return blocks
    .filter((b) => b.classification === 'body')
    .map((b) => b.text)
    .join('\n')
    .trim()
}

function buildSections(
  pages: Page[],
  boundaries: Array<{ startPage: number; title: string; confidence: number }>,
  source: SectionSource,
  lastPage: number,
): Section[] {
  if (boundaries.length === 0) return []
  const sorted = [...boundaries].sort((a, b) => a.startPage - b.startPage)
  return sorted.map((b, idx) => {
    const next = sorted[idx + 1]
    const endPage = next ? Math.max(b.startPage, next.startPage - 1) : lastPage
    const startPage = Math.min(Math.max(1, b.startPage), lastPage)
    const safeEnd = Math.min(Math.max(startPage, endPage), lastPage)
    const blocks = blocksInPageRange(pages, startPage, safeEnd)
    const order = idx + 1
    return {
      id: makeSectionId(order, b.title),
      order,
      title: b.title,
      startPage,
      endPage: safeEnd,
      blocks,
      rawText: bodyTextFor(blocks),
      source,
      confidence: b.confidence,
    }
  })
}

function dedupeNearbyBoundaries<T extends { startPage: number }>(
  boundaries: T[],
  tolerance: number,
): T[] {
  const sorted = [...boundaries].sort((a, b) => a.startPage - b.startPage)
  const out: T[] = []
  for (const item of sorted) {
    const last = out[out.length - 1]
    if (last && Math.abs(item.startPage - last.startPage) <= tolerance) continue
    out.push(item)
  }
  return out
}

function flattenOutline(nodes: OutlineNode[], depth = 0): Array<{ startPage: number; title: string; depth: number }> {
  const out: Array<{ startPage: number; title: string; depth: number }> = []
  for (const node of nodes) {
    out.push({ startPage: node.startPage, title: node.title, depth })
    if (node.children && node.children.length > 0) {
      for (const child of flattenOutline(node.children, depth + 1)) out.push(child)
    }
  }
  return out
}

function aborted(signal?: AbortSignal): boolean {
  return Boolean(signal?.aborted)
}

function emitProgress(emit: Emit | undefined, completed: number, total: number): void {
  emit?.({ kind: 'phase-progress', phase: PHASE_NAME, completed, total })
}

async function runStructureWindow(
  client: LLMClient,
  windowText: string,
  windowStartPage: number,
  windowEndPage: number,
  signal: AbortSignal | undefined,
  requestId: string,
): Promise<{ boundaries: Boundary[]; ok: boolean }> {
  const prompt = getPrompt('structure')
  const user = [
    `Identify chapter/section boundaries in this window covering pages ${windowStartPage}–${windowEndPage}.`,
    'Return JSON: {"boundaries":[{"boundaryPageNumber":N,"suggestedTitle":"…","confidence":0..1}]}.',
    'Only list pages where a new chapter/section begins inside the window. If none, return an empty array.',
  ].join('\n')

  const result = await client.callWithBookContent({
    role: prompt.meta.role,
    temperature: prompt.meta.temperature,
    responseFormat: prompt.meta.responseFormat === 'json' ? { jsonSchema: {} } : 'text',
    system: prompt.body,
    user,
    bookContent: windowText,
    signal,
    metadata: { phase: PHASE_NAME, requestId },
  })
  if (!result.ok) return { boundaries: [], ok: false }

  try {
    const parsed = structureResponseSchema.parse(JSON.parse(result.data))
    const filtered = parsed.boundaries.filter(
      (b) => b.boundaryPageNumber >= windowStartPage && b.boundaryPageNumber <= windowEndPage,
    )
    return { boundaries: filtered, ok: true }
  } catch {
    return { boundaries: [], ok: true }
  }
}

function pageWindowText(pages: Page[], startPage: number, endPage: number): string {
  const out: string[] = []
  for (const page of pages) {
    if (page.number < startPage || page.number > endPage) continue
    const body = page.blocks
      .filter((b) => b.classification === 'body')
      .map((b) => b.text)
      .join(' ')
    out.push(`--- page ${page.number} ---\n${body}`)
  }
  return out.join('\n')
}

function chooseSampleIndices(total: number, sampleRate: number): number[] {
  if (total === 0 || sampleRate <= 0) return []
  const count = Math.max(1, Math.round(total * sampleRate))
  if (count >= total) return Array.from({ length: total }, (_, i) => i)
  const step = total / count
  const indices = new Set<number>()
  for (let i = 0; i < count; i += 1) indices.add(Math.floor(i * step))
  return Array.from(indices).sort((a, b) => a - b)
}

type WindowSpec = { startPage: number; endPage: number }

function buildWindows(lastPage: number, windowPages: number): WindowSpec[] {
  const out: WindowSpec[] = []
  for (let start = 1; start <= lastPage; start += windowPages) {
    const end = Math.min(lastPage, start + windowPages - 1)
    out.push({ startPage: start, endPage: end })
  }
  return out
}

function lastPageNumber(book: ParsedBook): number {
  return book.pages.length === 0
    ? 0
    : Math.max(...book.pages.map((p) => p.number))
}

async function detectFromLlmWindows(
  book: ParsedBook,
  client: LLMClient,
  opts: { windowPages: number; signal?: AbortSignal; emit?: Emit },
): Promise<{ boundaries: Array<Boundary & { source: 'llm' }>; warnings: string[] }> {
  const last = lastPageNumber(book)
  const windows = buildWindows(last, opts.windowPages)
  const warnings: string[] = []
  const collected: Array<Boundary & { source: 'llm' }> = []

  let completed = 0
  const results = await mapWithLimit(windows, DEFAULT_LLM_CONCURRENCY, async (win) => {
    if (aborted(opts.signal)) return null
    const text = pageWindowText(book.pages, win.startPage, win.endPage)
    const out = await runStructureWindow(
      client,
      text,
      win.startPage,
      win.endPage,
      opts.signal,
      `phaseA-llm-${win.startPage}`,
    )
    completed += 1
    emitProgress(opts.emit, completed, windows.length)
    return out
  })

  for (let i = 0; i < windows.length; i += 1) {
    const win = windows[i]
    const out = results[i]
    if (!out) continue
    if (!out.ok) {
      warnings.push(`Structure LLM call failed for pages ${win.startPage}–${win.endPage}.`)
    }
    for (const b of out.boundaries) collected.push({ ...b, source: 'llm' })
  }

  return { boundaries: collected, warnings }
}

async function llmCrossCheck(
  book: ParsedBook,
  outlineBoundaries: Array<{ startPage: number; title: string }>,
  client: LLMClient,
  opts: { windowPages: number; sampleRate: number; signal?: AbortSignal },
): Promise<{ disagreementRatio: number; llmBoundaries: Array<Boundary> }> {
  const last = lastPageNumber(book)
  const windows = buildWindows(last, opts.windowPages)
  if (windows.length === 0) return { disagreementRatio: 0, llmBoundaries: [] }
  const sampleIdx = chooseSampleIndices(windows.length, opts.sampleRate)

  const samples = await mapWithLimit(sampleIdx, DEFAULT_LLM_CONCURRENCY, async (idx) => {
    if (aborted(opts.signal)) return null
    const win = windows[idx]
    const text = pageWindowText(book.pages, win.startPage, win.endPage)
    const out = await runStructureWindow(
      client,
      text,
      win.startPage,
      win.endPage,
      opts.signal,
      `phaseA-crosscheck-${win.startPage}`,
    )
    return { idx, win, out }
  })

  let disagreements = 0
  let comparisons = 0
  const llmBoundaries: Boundary[] = []

  for (const sample of samples) {
    if (!sample) continue
    const { win, out } = sample
    for (const b of out.boundaries) llmBoundaries.push(b)
    comparisons += 1
    const outlineInWindow = outlineBoundaries.filter(
      (o) => o.startPage >= win.startPage && o.startPage <= win.endPage,
    )
    const llmInWindow = out.boundaries
    const matched = outlineInWindow.every((o) =>
      llmInWindow.some((l) => Math.abs(l.boundaryPageNumber - o.startPage) <= BOUNDARY_TOLERANCE_PAGES),
    )
    const reverseMatched = llmInWindow.every((l) =>
      outlineInWindow.some((o) => Math.abs(l.boundaryPageNumber - o.startPage) <= BOUNDARY_TOLERANCE_PAGES),
    )
    if (!matched || !reverseMatched) disagreements += 1
  }

  const ratio = comparisons === 0 ? 0 : disagreements / comparisons
  return { disagreementRatio: ratio, llmBoundaries }
}

function spineBoundaries(book: ParsedBook): Array<{ startPage: number; title: string; confidence: number }> {
  if (!book.spine || book.spine.length === 0) return []
  const seenSpine = new Set<string>()
  const out: Array<{ startPage: number; title: string; confidence: number }> = []
  let order = 1
  for (const page of book.pages) {
    const spineItemId = page.blocks.find((b) => b.spineItemId)?.spineItemId
    if (!spineItemId) continue
    if (seenSpine.has(spineItemId)) continue
    seenSpine.add(spineItemId)
    const firstText = page.blocks.find((b) => b.text.length > 0)?.text ?? ''
    const title = firstText.trim().slice(0, 80) || `Spine item ${order}`
    out.push({ startPage: page.number, title, confidence: 0.9 })
    order += 1
  }
  return out
}

function estimateTokensFromText(text: string): number {
  return Math.max(1, Math.ceil(text.length / CHARS_PER_TOKEN_HEURISTIC))
}

async function splitOversizedSpineSection(
  section: Section,
  client: LLMClient,
  budget: number,
  opts: { signal?: AbortSignal },
): Promise<Section[]> {
  const estimate = estimateTokensFromText(section.rawText)
  if (estimate <= budget) return [section]
  const prompt = getPrompt('structure')
  const user = [
    `This EPUB spine item titled "${section.title}" exceeds the context budget.`,
    'Propose sub-section boundaries by suggesting cut points in the text.',
    'Return JSON: {"boundaries":[{"boundaryPageNumber":N,"suggestedTitle":"…","confidence":0..1}]}.',
    'The pageNumber should be a 1-based index into the supplied blocks.',
  ].join('\n')
  const result = await client.callWithBookContent({
    role: prompt.meta.role,
    temperature: prompt.meta.temperature,
    responseFormat: prompt.meta.responseFormat === 'json' ? { jsonSchema: {} } : 'text',
    system: prompt.body,
    user,
    bookContent: section.rawText,
    signal: opts.signal,
    metadata: { phase: PHASE_NAME, requestId: `phaseA-split-${section.id}` },
  })
  if (!result.ok) return [section]
  try {
    const parsed = structureResponseSchema.parse(JSON.parse(result.data))
    const cuts = parsed.boundaries
      .map((b) => b.boundaryPageNumber)
      .filter((n) => n > 1 && n <= section.blocks.length)
      .sort((a, b) => a - b)
    if (cuts.length === 0) return [section]
    const ranges: Array<{ start: number; end: number; title: string }> = []
    let prev = 0
    for (let i = 0; i < cuts.length; i += 1) {
      const cut = cuts[i]
      const title = parsed.boundaries[i].suggestedTitle
      ranges.push({ start: prev, end: cut - 1, title })
      prev = cut - 1
    }
    ranges.push({ start: prev, end: section.blocks.length - 1, title: `${section.title} (cont.)` })
    return ranges
      .filter((r) => r.end >= r.start)
      .map((r, idx) => {
        const slice = section.blocks.slice(r.start, r.end + 1)
        const order = section.order * 100 + idx
        return {
          ...section,
          id: `${section.id}-part-${idx + 1}`,
          order,
          title: r.title,
          blocks: slice,
          rawText: bodyTextFor(slice),
          source: 'llm-detected',
          confidence: 0.6,
        }
      })
  } catch {
    return [section]
  }
}

export async function phaseAStructure(
  book: ParsedBook,
  client: LLMClient,
  opts: PhaseAOptions = {},
): Promise<PhaseAResult> {
  const start = Date.now()
  const emit = opts.emit
  emit?.({ kind: 'phase-start', phase: PHASE_NAME })

  const windowPages = opts.windowPages ?? DEFAULT_WINDOW_PAGES
  const sampleRate = opts.llmCrossCheckSampleRate ?? DEFAULT_LLM_CROSS_CHECK_SAMPLE_RATE
  const spineBudget = opts.spineTokenBudget ?? SPINE_TOKEN_BUDGET
  const last = lastPageNumber(book)
  const warnings: string[] = []

  try {
    if (book.format === 'epub') {
      const spineSegments = spineBoundaries(book)
      if (spineSegments.length === 0) {
        warnings.push('EPUB spine could not be derived; falling back to whole-book section.')
        const blocks = book.pages.flatMap((p) => p.blocks)
        const section: Section = {
          id: 'sec-001-whole-book',
          order: 1,
          title: book.title || 'Untitled',
          startPage: 1,
          endPage: last,
          blocks,
          rawText: bodyTextFor(blocks),
          source: 'spine',
          confidence: 0.5,
        }
        emit?.({ kind: 'phase-end', phase: PHASE_NAME, durationMs: Date.now() - start })
        return { sections: [section], source: 'spine', warnings }
      }

      const initial = buildSections(book.pages, spineSegments, 'spine', last)
      const partsList = await mapWithLimit(initial, DEFAULT_LLM_CONCURRENCY, async (sec) => {
        if (aborted(opts.signal)) return [sec]
        return splitOversizedSpineSection(sec, client, spineBudget, { signal: opts.signal })
      })
      const expanded: Section[] = partsList.flat()
      const renumbered = expanded.map((s, i) => ({ ...s, order: i + 1 }))
      const usedLlm = renumbered.length !== initial.length
      emit?.({ kind: 'phase-end', phase: PHASE_NAME, durationMs: Date.now() - start })
      return {
        sections: renumbered,
        source: usedLlm ? 'hybrid' : 'spine',
        warnings,
      }
    }

    const outlineNodes = opts.outline ?? null
    if (outlineNodes && outlineNodes.length > 0) {
      const flat = flattenOutline(outlineNodes)
        .map((n) => ({ startPage: n.startPage, title: n.title, confidence: 0.85 }))
      const deduped = dedupeNearbyBoundaries(flat, BOUNDARY_DEDUPE_PAGES)
      const cross = await llmCrossCheck(book, deduped, client, {
        windowPages,
        sampleRate,
        signal: opts.signal,
      })
      if (cross.disagreementRatio > HYBRID_DISAGREEMENT_RATIO) {
        warnings.push(
          `Outline disagrees with LLM on ${(cross.disagreementRatio * 100).toFixed(0)}% of sampled windows; using LLM-preferred boundaries.`,
        )
        const llmConverted = cross.llmBoundaries.map((b) => ({
          startPage: b.boundaryPageNumber,
          title: b.suggestedTitle,
          confidence: b.confidence,
        }))
        const merged = dedupeNearbyBoundaries(
          [...deduped, ...llmConverted],
          BOUNDARY_DEDUPE_PAGES,
        )
        const sections = buildSections(book.pages, merged, 'outline', last).map((s) => ({
          ...s,
          source: 'outline' as const,
        }))
        emit?.({ kind: 'phase-end', phase: PHASE_NAME, durationMs: Date.now() - start })
        return { sections, source: 'hybrid', warnings }
      }
      const sections = buildSections(book.pages, deduped, 'outline', last)
      emit?.({ kind: 'phase-end', phase: PHASE_NAME, durationMs: Date.now() - start })
      return { sections, source: 'outline', warnings }
    }

    const { boundaries, warnings: llmWarnings } = await detectFromLlmWindows(book, client, {
      windowPages,
      signal: opts.signal,
      emit,
    })
    for (const w of llmWarnings) warnings.push(w)
    const converted = boundaries.map((b) => ({
      startPage: b.boundaryPageNumber,
      title: b.suggestedTitle,
      confidence: b.confidence,
    }))
    const deduped = dedupeNearbyBoundaries(converted, BOUNDARY_DEDUPE_PAGES)
    if (deduped.length === 0) {
      deduped.push({ startPage: 1, title: book.title || 'Untitled', confidence: 0.3 })
    } else if (deduped[0].startPage > 1) {
      deduped.unshift({ startPage: 1, title: 'Opening', confidence: 0.3 })
    }
    const avgConfidence = deduped.reduce((s, b) => s + b.confidence, 0) / deduped.length
    if (avgConfidence < LOW_CONFIDENCE_THRESHOLD) {
      warnings.push('Structural confidence low; consider running no-chapter route')
    }
    const sections = buildSections(book.pages, deduped, 'llm-detected', last)
    emit?.({ kind: 'phase-end', phase: PHASE_NAME, durationMs: Date.now() - start })
    return { sections, source: 'llm-detected', warnings }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    emit?.({ kind: 'phase-error', phase: PHASE_NAME, error: message })
    throw err
  }
}
