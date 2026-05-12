import * as pdfjsLib from 'pdfjs-dist'
import type {
  PDFDocumentProxy,
  PDFPageProxy,
  TextContent,
  TextItem,
} from 'pdfjs-dist/types/src/display/api'

import { classifyMatter } from './frontmatter'
import { classifyProtected } from './protected-blocks'
import type {
  BBox,
  Block,
  BlockClassification,
  Page,
  ParseResult,
  ParsedBook,
} from './types'

const WORKER_PATH = 'pdfjs-worker/pdf.worker.min.mjs'
const NO_TEXT_LAYER_PAGE_THRESHOLD = 5
const NO_TEXT_LAYER_TOTAL_CHARS = 100
const ROW_TOLERANCE_FACTOR = 0.6
const COLUMN_GAP_THRESHOLD = 60
const HEADER_FOOTER_FREQ_THRESHOLD = 0.3
const HEADER_FOOTER_MAX_LEN = 80
const HEADER_BAND_FRACTION = 0.1
const FOOTER_BAND_FRACTION = 0.1
const FOOTNOTE_BAND_FRACTION = 0.25
const CAPTION_PREFIX_RE = /^(figure|fig\.|table|plate|diagram|map)\b/i
const FOLIO_RE = /^([ivxlcdm]+|\d{1,4})$/i
const FOOTNOTE_START_RE = /^[¹²³⁰-⁹*†‡§]|^\s*\d{1,3}[.)]\s+\S/

let workerConfigured = false

const configureWorker = (): void => {
  if (workerConfigured) return
  const base = import.meta.env.BASE_URL ?? '/'
  const normalizedBase = base.endsWith('/') ? base : `${base}/`
  pdfjsLib.GlobalWorkerOptions.workerSrc = `${normalizedBase}${WORKER_PATH}`
  workerConfigured = true
}

const isTextItem = (item: unknown): item is TextItem => {
  if (!item || typeof item !== 'object') return false
  return 'str' in item && typeof (item as { str: unknown }).str === 'string'
}

type RawItem = {
  text: string
  fontName: string
  x: number
  y: number
  width: number
  height: number
  hasEOL: boolean
}

const itemFromTextItem = (item: TextItem, pageHeight: number): RawItem => {
  const transform = item.transform ?? [1, 0, 0, 1, 0, 0]
  const x = typeof transform[4] === 'number' ? transform[4] : 0
  const yFromBottom = typeof transform[5] === 'number' ? transform[5] : 0
  const y = pageHeight - yFromBottom
  return {
    text: item.str ?? '',
    fontName: item.fontName ?? '',
    x,
    y,
    width: item.width ?? 0,
    height: item.height ?? 0,
    hasEOL: item.hasEOL ?? false,
  }
}

type RowCluster = {
  yCenter: number
  height: number
  items: RawItem[]
}

const clusterRows = (items: RawItem[]): RowCluster[] => {
  if (items.length === 0) return []
  const sorted = [...items].sort((a, b) => a.y - b.y)
  const rows: RowCluster[] = []
  for (const item of sorted) {
    const lineHeight = Math.max(item.height, 4)
    const tolerance = lineHeight * ROW_TOLERANCE_FACTOR
    const last = rows[rows.length - 1]
    if (last && Math.abs(item.y - last.yCenter) <= tolerance) {
      last.items.push(item)
      last.yCenter =
        (last.yCenter * (last.items.length - 1) + item.y) / last.items.length
      last.height = Math.max(last.height, lineHeight)
    } else {
      rows.push({ yCenter: item.y, height: lineHeight, items: [item] })
    }
  }
  return rows
}

const detectColumnSplit = (items: RawItem[], pageWidth: number): number | null => {
  if (items.length < 20) return null
  const xs = items.map((i) => i.x).sort((a, b) => a - b)
  const mid = pageWidth / 2
  let bestGap = 0
  let bestSplit: number | null = null
  for (let i = 1; i < xs.length; i += 1) {
    const gap = xs[i] - xs[i - 1]
    if (gap > bestGap && xs[i - 1] < mid && xs[i] > mid && gap > COLUMN_GAP_THRESHOLD) {
      bestGap = gap
      bestSplit = (xs[i - 1] + xs[i]) / 2
    }
  }
  return bestSplit
}

type RawBlock = {
  text: string
  fontHint: string
  bbox: BBox
  hasEOL: boolean
}

const rowToBlocks = (row: RowCluster, columnSplit: number | null): RawBlock[] => {
  const sortedItems = [...row.items].sort((a, b) => a.x - b.x)
  if (columnSplit === null) return [combineRowItems(sortedItems)]
  const left = sortedItems.filter((i) => i.x + i.width / 2 < columnSplit)
  const right = sortedItems.filter((i) => i.x + i.width / 2 >= columnSplit)
  const blocks: RawBlock[] = []
  if (left.length > 0) blocks.push(combineRowItems(left))
  if (right.length > 0) blocks.push(combineRowItems(right))
  return blocks
}

const combineRowItems = (items: RawItem[]): RawBlock => {
  const text = items
    .map((i) => i.text)
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
  const xs = items.map((i) => i.x)
  const ys = items.map((i) => i.y)
  const rights = items.map((i) => i.x + i.width)
  const bottoms = items.map((i) => i.y + i.height)
  const minX = Math.min(...xs)
  const minY = Math.min(...ys)
  const maxX = Math.max(...rights)
  const maxY = Math.max(...bottoms)
  const fontCounts = new Map<string, number>()
  for (const i of items) {
    const key = i.fontName || ''
    fontCounts.set(key, (fontCounts.get(key) ?? 0) + 1)
  }
  let dominantFont = ''
  let dominantCount = -1
  for (const [name, count] of fontCounts) {
    if (count > dominantCount) {
      dominantFont = name
      dominantCount = count
    }
  }
  const hasEOL = items.some((i) => i.hasEOL)
  return {
    text,
    fontHint: dominantFont,
    bbox: { x: minX, y: minY, w: maxX - minX, h: maxY - minY },
    hasEOL,
  }
}

type PageExtraction = {
  pageNumber: number
  width: number
  height: number
  rawBlocks: RawBlock[]
}

const extractPageBlocks = async (
  page: PDFPageProxy,
  pageNumber: number,
): Promise<PageExtraction> => {
  const viewport = page.getViewport({ scale: 1 })
  const content: TextContent = await page.getTextContent()
  const items: RawItem[] = []
  for (const raw of content.items) {
    if (!isTextItem(raw)) continue
    if (!raw.str) continue
    items.push(itemFromTextItem(raw, viewport.height))
  }
  const rows = clusterRows(items)
  const columnSplit = detectColumnSplit(items, viewport.width)
  const rawBlocks = rows.flatMap((row) => rowToBlocks(row, columnSplit))
  return {
    pageNumber,
    width: viewport.width,
    height: viewport.height,
    rawBlocks,
  }
}

const classifyBlock = (
  raw: RawBlock,
  pageHeight: number,
  headerFooterTexts: Set<string>,
): BlockClassification => {
  const trimmed = raw.text.trim()
  if (!trimmed) return 'body'
  if (headerFooterTexts.has(trimmed)) {
    const topY = raw.bbox.y
    if (topY < pageHeight * HEADER_BAND_FRACTION) return 'header'
    if (topY > pageHeight * (1 - FOOTER_BAND_FRACTION)) return 'footer'
  }
  if (FOLIO_RE.test(trimmed) && trimmed.length <= 6) {
    if (
      raw.bbox.y < pageHeight * HEADER_BAND_FRACTION ||
      raw.bbox.y > pageHeight * (1 - FOOTER_BAND_FRACTION)
    ) {
      return 'folio'
    }
  }
  if (CAPTION_PREFIX_RE.test(trimmed) && trimmed.length < 200) return 'caption'
  if (
    raw.bbox.y > pageHeight * (1 - FOOTNOTE_BAND_FRACTION) &&
    FOOTNOTE_START_RE.test(trimmed)
  ) {
    return 'footnote'
  }
  return 'body'
}

const buildHeaderFooterTexts = (pages: PageExtraction[]): Set<string> => {
  const candidates = new Map<string, number>()
  for (const page of pages) {
    const seen = new Set<string>()
    for (const block of page.rawBlocks) {
      const trimmed = block.text.trim()
      if (!trimmed || trimmed.length > HEADER_FOOTER_MAX_LEN) continue
      const topY = block.bbox.y
      const inHeader = topY < page.height * HEADER_BAND_FRACTION
      const inFooter = topY > page.height * (1 - FOOTER_BAND_FRACTION)
      if (!inHeader && !inFooter) continue
      if (seen.has(trimmed)) continue
      seen.add(trimmed)
      candidates.set(trimmed, (candidates.get(trimmed) ?? 0) + 1)
    }
  }
  const threshold = Math.max(2, Math.ceil(pages.length * HEADER_FOOTER_FREQ_THRESHOLD))
  const result = new Set<string>()
  for (const [text, count] of candidates) {
    if (count >= threshold) result.add(text)
  }
  return result
}

type DocumentMetadata = {
  title?: string
  author?: string
}

const extractMetadata = async (doc: PDFDocumentProxy): Promise<DocumentMetadata> => {
  try {
    const meta = await doc.getMetadata()
    const info = meta.info as { Title?: unknown; Author?: unknown } | undefined
    const titleRaw = info?.Title
    const authorRaw = info?.Author
    return {
      title: typeof titleRaw === 'string' && titleRaw.trim() ? titleRaw.trim() : undefined,
      author: typeof authorRaw === 'string' && authorRaw.trim() ? authorRaw.trim() : undefined,
    }
  } catch {
    return {}
  }
}

const generateBookId = (): string => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `pdf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

const fontHintLookup = (fontHints: Map<string, string>) => (block: Block): string | undefined => {
  return fontHints.get(block.id)
}

export type ParsePdfOptions = {
  password?: string
  signal?: AbortSignal
}

const toUint8Array = async (source: File | Blob | ArrayBuffer | Uint8Array): Promise<Uint8Array> => {
  if (source instanceof Uint8Array) return source
  if (source instanceof ArrayBuffer) return new Uint8Array(source)
  const buffer = await source.arrayBuffer()
  return new Uint8Array(buffer)
}

const abortedResult = (): ParseResult => ({
  ok: false,
  reason: 'unknown',
  message: 'PDF parse aborted.',
})

export const parsePdf = async (
  file: File | Blob,
  opts: ParsePdfOptions = {},
): Promise<ParseResult> => {
  configureWorker()
  const warnings: string[] = []
  const { password, signal } = opts

  if (signal?.aborted) return abortedResult()

  let data: Uint8Array
  try {
    data = await toUint8Array(file)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, reason: 'corrupt', message: `Failed to read file: ${message}` }
  }

  let doc: PDFDocumentProxy
  try {
    const loadingTask = pdfjsLib.getDocument({ data, password })
    signal?.addEventListener(
      'abort',
      () => {
        loadingTask.destroy().catch(() => undefined)
      },
      { once: true },
    )
    doc = await loadingTask.promise
  } catch (error) {
    const err = error as { name?: string; message?: string; code?: number }
    if (err?.name === 'PasswordException' || /password/i.test(err?.message ?? '')) {
      return {
        ok: false,
        reason: 'password-required',
        message: 'This PDF is password-protected. Provide the password to continue.',
      }
    }
    if (err?.name === 'InvalidPDFException' || /invalid pdf/i.test(err?.message ?? '')) {
      return {
        ok: false,
        reason: 'corrupt',
        message: 'The file could not be parsed as a valid PDF.',
      }
    }
    return {
      ok: false,
      reason: 'unknown',
      message: err?.message ?? 'Unknown error opening PDF.',
    }
  }

  const metadata = await extractMetadata(doc)
  const numPages = doc.numPages
  const extractions: PageExtraction[] = []

  for (let pageNumber = 1; pageNumber <= numPages; pageNumber += 1) {
    if (signal?.aborted) {
      try {
        await doc.destroy()
      } catch {
        // ignore
      }
      return abortedResult()
    }
    let pageProxy: PDFPageProxy | null = null
    try {
      pageProxy = await doc.getPage(pageNumber)
      const extraction = await extractPageBlocks(pageProxy, pageNumber)
      extractions.push(extraction)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      warnings.push(`Page ${pageNumber} failed to parse: ${message}`)
      extractions.push({ pageNumber, width: 0, height: 0, rawBlocks: [] })
    } finally {
      if (pageProxy) {
        try {
          pageProxy.cleanup()
        } catch {
          // ignore cleanup failures
        }
      }
    }
  }

  try {
    await doc.cleanup()
  } catch {
    // ignore
  }
  try {
    await doc.destroy()
  } catch {
    // ignore
  }

  const totalChars = extractions.reduce(
    (sum, p) => sum + p.rawBlocks.reduce((s, b) => s + b.text.length, 0),
    0,
  )
  if (numPages > NO_TEXT_LAYER_PAGE_THRESHOLD && totalChars < NO_TEXT_LAYER_TOTAL_CHARS) {
    return {
      ok: false,
      reason: 'no-text-layer',
      message:
        'This PDF appears to be scanned (no extractable text layer). OCR is not yet supported.',
    }
  }

  const headerFooterTexts = buildHeaderFooterTexts(extractions)

  const fontHints = new Map<string, string>()
  const pages: Page[] = extractions.map((extraction) => {
    const blocks: Block[] = extraction.rawBlocks.map((raw, index) => {
      const id = `${extraction.pageNumber}-${index}`
      fontHints.set(id, raw.fontHint)
      const classification = classifyBlock(raw, extraction.height, headerFooterTexts)
      return {
        id,
        text: raw.text,
        classification,
        pageNumber: extraction.pageNumber,
        bbox: raw.bbox,
      }
    })
    const protectedBlocks = classifyProtected(blocks, {
      fontLookup: fontHintLookup(fontHints),
    })
    return { number: extraction.pageNumber, blocks: protectedBlocks }
  })

  const rawText = pages
    .flatMap((p) => p.blocks.filter((b) => b.classification === 'body').map((b) => b.text))
    .join('\n')
    .trim()

  const draft: ParsedBook = {
    id: generateBookId(),
    format: 'pdf',
    title: metadata.title,
    author: metadata.author,
    pages,
    rawText,
    matter: { detected: [] },
    warnings,
  }
  const book: ParsedBook = { ...draft, matter: classifyMatter(draft) }

  return { ok: true, book }
}
