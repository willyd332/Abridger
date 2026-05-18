import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'

import type { LLMClient } from '@/llm/client'

import type { NarrativeSpine } from '../types'

import { buildFragments, generateBrackets } from './export'
import type { Fragment, OntologyTree } from './types'

export type PdfExportInput = {
  tree: OntologyTree
  inclusion: Record<string, boolean>
  bookText: string
  originalBlob: Blob
  // First original-PDF page (1-indexed) treated as logical page 1 of the
  // analyzed body. Pages 1..(startPage-1) in the original are preamble
  // (cover, copyright, TOC, dedication, …) — the edit-in-place export
  // preserves them untouched because no ontology fragment claims them.
  // Ontology node startPage/endPage are LOGICAL: the export converts to
  // original-PDF page indices via pageOffset = startPage - 1.
  startPage?: number
  spine?: NarrativeSpine | null
  voiceSample?: string
  purpose?: string
  client: LLMClient
  signal?: AbortSignal
  concurrency?: number
  onBracketDone?: (done: number, total: number) => void
}

export type PdfExportOutput = {
  blob: Blob
  filename: string
  stats: {
    originalPageCount: number
    keptPageCount: number
    bracketCount: number
    summaryPagesInserted: number
  }
}

const MARGIN_X = 64
const TOP_MARGIN = 80
const BOTTOM_MARGIN = 64
const TITLE_SIZE = 14
const HEADER_SIZE = 10
const BODY_SIZE = 11
const BODY_LEADING = 16
const PARAGRAPH_GAP = 8

function wrapParagraph(
  text: string,
  font: PDFFont,
  size: number,
  maxWidth: number,
): string[] {
  const words = text.replace(/\s+/g, ' ').trim().split(' ')
  if (words.length === 0) return ['']
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    const candidate = current.length === 0 ? word : `${current} ${word}`
    const width = font.widthOfTextAtSize(candidate, size)
    if (width <= maxWidth) {
      current = candidate
      continue
    }
    if (current.length > 0) {
      lines.push(current)
      current = word
    } else {
      lines.push(word)
      current = ''
    }
  }
  if (current.length > 0) lines.push(current)
  return lines
}

type Cursor = {
  page: PDFPage
  y: number
}

function newSummaryPage(
  out: PDFDocument,
  font: PDFFont,
  italic: PDFFont,
  nodeTitle: string,
  isContinuation: boolean,
): Cursor {
  const page = out.addPage()
  const { width, height } = page.getSize()
  const innerWidth = width - MARGIN_X * 2

  page.drawLine({
    start: { x: MARGIN_X, y: height - 56 },
    end: { x: width - MARGIN_X, y: height - 56 },
    thickness: 0.5,
    color: rgb(0.72, 0.52, 0.04),
    opacity: 0.55,
  })

  const header = isContinuation
    ? `Editorial bracket — ${nodeTitle} (cont’d)`
    : `Editorial bracket — ${nodeTitle}`
  const headerLines = wrapParagraph(header, italic, HEADER_SIZE, innerWidth)
  let cursorY = height - 44
  for (const line of headerLines) {
    page.drawText(line, {
      x: MARGIN_X,
      y: cursorY,
      font: italic,
      size: HEADER_SIZE,
      color: rgb(0.45, 0.34, 0.04),
    })
    cursorY -= 14
  }

  if (!isContinuation) {
    cursorY = height - 90
    page.drawText(nodeTitle, {
      x: MARGIN_X,
      y: cursorY,
      font,
      size: TITLE_SIZE,
      color: rgb(0.16, 0.1, 0.06),
    })
    cursorY -= 26
  } else {
    cursorY = height - TOP_MARGIN
  }

  return { page, y: cursorY }
}

function drawBracketBody(
  out: PDFDocument,
  font: PDFFont,
  italic: PDFFont,
  nodeTitle: string,
  text: string,
): number {
  let cursor = newSummaryPage(out, font, italic, nodeTitle, false)
  let pageCount = 1
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
  if (paragraphs.length === 0) paragraphs.push(text.trim() || '[Summary unavailable]')

  const drawableWidth = cursor.page.getSize().width - MARGIN_X * 2

  for (let i = 0; i < paragraphs.length; i += 1) {
    const para = paragraphs[i]
    const lines = wrapParagraph(para, font, BODY_SIZE, drawableWidth)
    for (const line of lines) {
      if (cursor.y < BOTTOM_MARGIN) {
        cursor = newSummaryPage(out, font, italic, nodeTitle, true)
        pageCount += 1
      }
      cursor.page.drawText(line, {
        x: MARGIN_X,
        y: cursor.y,
        font,
        size: BODY_SIZE,
        color: rgb(0.16, 0.1, 0.06),
      })
      cursor.y -= BODY_LEADING
    }
    if (i < paragraphs.length - 1) {
      cursor.y -= PARAGRAPH_GAP
    }
  }
  return pageCount
}

// Hard-fail the export if any leaf overlapping any fragment is missing page
// data. Runs BEFORE generateBrackets so a doomed export doesn't burn LLM
// budget before failing.
export function preflightPageData(fragments: Fragment[], tree: OntologyTree): void {
  for (const frag of fragments) {
    for (const leafId of tree.leafIdsInOrder) {
      const leaf = tree.nodes[leafId]
      if (!leaf) continue
      if (leaf.endOffset <= frag.startOffset) continue
      if (leaf.startOffset >= frag.endOffset) break
      if (leaf.startPage == null || leaf.endPage == null) {
        throw new Error(
          `Cannot export: section "${leaf.title}" is missing page data — re-run structural analysis.`,
        )
      }
    }
  }
}

// Union of logical page numbers (1-indexed within the analyzed slice) covered
// by all leaves that overlap the fragment's byte range. Works for fine-grained
// leaf fragments and for merged/parent fragments whose byte range spans many
// leaves — the answer is "what pages does this fragment touch in the book."
function fragmentPageRange(
  frag: Fragment,
  tree: OntologyTree,
): { lo: number; hi: number } | null {
  let lo: number | null = null
  let hi: number | null = null
  for (const leafId of tree.leafIdsInOrder) {
    const leaf = tree.nodes[leafId]
    if (!leaf) continue
    if (leaf.endOffset <= frag.startOffset) continue
    if (leaf.startOffset >= frag.endOffset) break
    if (leaf.startPage == null || leaf.endPage == null) continue
    if (lo == null || leaf.startPage < lo) lo = leaf.startPage
    if (hi == null || leaf.endPage > hi) hi = leaf.endPage
  }
  if (lo == null || hi == null) return null
  return { lo, hi }
}

export type DeletionInterval = {
  nodeId: string
  startPageIdx: number // 0-indexed original-PDF page
  endPageIdx: number // 0-indexed original-PDF page (inclusive)
}

// Convert fragments into deletion intervals over the ORIGINAL PDF's 0-indexed
// page space. Honors three rules:
// - Pages outside every node's range (preamble, postamble, gaps) are NEVER
//   deleted: they appear in no fragment, so no interval covers them.
// - Keep wins on overlap: a page claimed by any keep fragment is never in
//   a deletion interval, even if a bracket fragment also overlaps it.
// - Leftmost wins attribution: when bracket fragments overlap on a page,
//   the earliest one in reading order owns it.
//
// Contiguous pages with the same owner collapse into a single interval.
// Brackets fully shadowed by keep pages produce zero intervals — their
// summary text is intentionally dropped (would be a stranded summary).
export function resolveDeletionIntervals(
  fragments: Fragment[],
  tree: OntologyTree,
  originalPageCount: number,
  pageOffset: number,
): DeletionInterval[] {
  const toOriginalPage = (logical: number): number => logical + pageOffset
  const keptPages = new Set<number>()
  for (const frag of fragments) {
    if (frag.kind !== 'keep') continue
    const range = fragmentPageRange(frag, tree)
    if (!range) continue
    const lo = Math.max(1 + pageOffset, toOriginalPage(range.lo))
    const hi = Math.min(originalPageCount, toOriginalPage(range.hi))
    for (let p = lo; p <= hi; p += 1) keptPages.add(p)
  }

  const pageOwner = new Map<number, string>()
  for (const frag of fragments) {
    if (frag.kind !== 'bracket') continue
    const range = fragmentPageRange(frag, tree)
    if (!range) continue
    const lo = Math.max(1 + pageOffset, toOriginalPage(range.lo))
    const hi = Math.min(originalPageCount, toOriginalPage(range.hi))
    for (let p = lo; p <= hi; p += 1) {
      if (keptPages.has(p)) continue
      if (!pageOwner.has(p)) pageOwner.set(p, frag.nodeId)
    }
  }

  const intervals: DeletionInterval[] = []
  let cur: { start: number; nodeId: string } | null = null
  for (let p = 1; p <= originalPageCount + 1; p += 1) {
    const owner = p <= originalPageCount ? pageOwner.get(p) : undefined
    if (cur && owner === cur.nodeId) continue
    if (cur) {
      intervals.push({
        nodeId: cur.nodeId,
        startPageIdx: cur.start - 1,
        endPageIdx: p - 2,
      })
    }
    cur = owner ? { start: p, nodeId: owner } : null
  }
  return intervals
}

export async function exportToPdf(
  inputs: PdfExportInput,
): Promise<PdfExportOutput> {
  const fragments = buildFragments(inputs.tree, inputs.inclusion)
  preflightPageData(fragments, inputs.tree)

  const brackets = await generateBrackets(fragments, {
    tree: inputs.tree,
    inclusion: inputs.inclusion,
    bookText: inputs.bookText,
    client: inputs.client,
    spine: inputs.spine,
    voiceSample: inputs.voiceSample,
    purpose: inputs.purpose,
    signal: inputs.signal,
    concurrency: inputs.concurrency,
    onBracketDone: inputs.onBracketDone,
  })
  const bracketByNode = new Map<string, string>()
  for (const b of brackets) bracketByNode.set(b.nodeId, b.text)

  const originalBytes = await inputs.originalBlob.arrayBuffer()
  // Many publisher PDFs ship with empty-owner-password encryption — pdf-lib
  // refuses by default. `ignoreEncryption: true` lets us mutate the document
  // in place. Real password-protected PDFs are rejected upstream in the parser.
  const original = await PDFDocument.load(originalBytes, { ignoreEncryption: true })
  const originalPageCount = original.getPageCount()

  const pageOffset =
    typeof inputs.startPage === 'number' && inputs.startPage > 1
      ? Math.floor(inputs.startPage) - 1
      : 0

  const intervals = resolveDeletionIntervals(
    fragments,
    inputs.tree,
    originalPageCount,
    pageOffset,
  )
  // Edit in reverse page order so earlier intervals' indices stay valid
  // through removals and insertions made for later intervals.
  const editPlan = [...intervals].sort((a, b) => b.startPageIdx - a.startPageIdx)

  let summaryPagesInserted = 0
  const bracketsHandled = new Set<string>()

  for (const interval of editPlan) {
    if (inputs.signal?.aborted) break
    const node = inputs.tree.nodes[interval.nodeId]
    const title = node?.title ?? 'Excluded section'
    const text = bracketByNode.get(interval.nodeId) ?? '[Editorial bracket unavailable.]'

    // Render summary pages in a scratch doc, then copy them into the original.
    // Keeps the original's font dictionary / page tree clean of anything other
    // than the pages we explicitly insert.
    const scratch = await PDFDocument.create()
    const font = await scratch.embedFont(StandardFonts.TimesRoman)
    const italic = await scratch.embedFont(StandardFonts.TimesRomanItalic)
    drawBracketBody(scratch, font, italic, title, text)
    const scratchCount = scratch.getPageCount()

    const indices = Array.from({ length: scratchCount }, (_, i) => i)
    const copied = await original.copyPages(scratch, indices)

    for (let p = interval.endPageIdx; p >= interval.startPageIdx; p -= 1) {
      original.removePage(p)
    }
    for (let j = 0; j < copied.length; j += 1) {
      original.insertPage(interval.startPageIdx + j, copied[j])
    }

    summaryPagesInserted += copied.length
    bracketsHandled.add(interval.nodeId)
  }

  original.setProducer('Abridger (edited)')

  const bytes = await original.save()
  const blob = new Blob([new Uint8Array(bytes)], { type: 'application/pdf' })
  const originalTitle = original.getTitle()
  const baseName =
    originalTitle?.replace(/[\\/\x00-\x1f]+/g, '_').slice(0, 80) ?? 'abridged'
  const filename = `${baseName}-abridged-${Date.now()}.pdf`

  const deletedPageCount = intervals.reduce(
    (sum, i) => sum + (i.endPageIdx - i.startPageIdx + 1),
    0,
  )

  return {
    blob,
    filename,
    stats: {
      originalPageCount,
      keptPageCount: originalPageCount - deletedPageCount,
      bracketCount: bracketsHandled.size,
      summaryPagesInserted,
    },
  }
}

export const __test__ = {
  preflightPageData,
  resolveDeletionIntervals,
}
