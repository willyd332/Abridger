import type { FrontBackMatter, FrontBackMatterKind, Page, ParsedBook } from './types'

type Pattern = { kind: FrontBackMatterKind; re: RegExp }

const FRONT_PATTERNS: Pattern[] = [
  { kind: 'toc', re: /^(table of contents|contents)\b/i },
  { kind: 'preface', re: /^preface\b/i },
  { kind: 'foreword', re: /^foreword\b/i },
  { kind: 'translator-note', re: /^(translator['’]s note|note from the translator|translator['’]s introduction)\b/i },
  { kind: 'dedication', re: /^dedication\b/i },
  { kind: 'acknowledgments', re: /^(acknowledgments|acknowledgements)\b/i },
]

const BACK_PATTERNS: Pattern[] = [
  { kind: 'index', re: /^(index|general index|subject index)\b/i },
  { kind: 'endnotes', re: /^(endnotes|notes)\b/i },
  { kind: 'bibliography', re: /^(bibliography|works cited|references)\b/i },
  { kind: 'appendix', re: /^appendix\b/i },
  { kind: 'glossary', re: /^glossary\b/i },
]

const headingCandidates = (page: Page): string[] => {
  if (page.blocks.length === 0) return []
  const candidates: string[] = []
  for (const block of page.blocks.slice(0, 4)) {
    if (block.classification === 'header' || block.classification === 'folio') continue
    const trimmed = block.text.trim()
    if (trimmed.length === 0) continue
    if (trimmed.length > 120) continue
    candidates.push(trimmed)
  }
  return candidates
}

const matchPatterns = (
  candidates: string[],
  patterns: Pattern[],
): FrontBackMatterKind | undefined => {
  for (const candidate of candidates) {
    for (const pattern of patterns) {
      if (pattern.re.test(candidate)) return pattern.kind
    }
  }
  return undefined
}

const computeRunRange = (
  pages: readonly Page[],
  startIndex: number,
  patterns: Pattern[],
): [number, number] => {
  let endIndex = startIndex
  for (let i = startIndex + 1; i < pages.length; i += 1) {
    const candidates = headingCandidates(pages[i])
    if (matchPatterns(candidates, patterns)) break
    endIndex = i
  }
  return [pages[startIndex].number, pages[endIndex].number]
}

const collectFront = (
  pages: readonly Page[],
  scanLimit: number,
): Array<{ kind: FrontBackMatterKind; pageRange: [number, number] }> => {
  const detected: Array<{ kind: FrontBackMatterKind; pageRange: [number, number] }> = []
  const limit = Math.min(pages.length, scanLimit)
  const seen = new Set<FrontBackMatterKind>()
  for (let i = 0; i < limit; i += 1) {
    const candidates = headingCandidates(pages[i])
    const kind = matchPatterns(candidates, FRONT_PATTERNS)
    if (!kind || seen.has(kind)) continue
    seen.add(kind)
    detected.push({ kind, pageRange: computeRunRange(pages, i, FRONT_PATTERNS) })
  }
  return detected
}

const collectBack = (
  pages: readonly Page[],
  scanLimit: number,
): Array<{ kind: FrontBackMatterKind; pageRange: [number, number] }> => {
  const detected: Array<{ kind: FrontBackMatterKind; pageRange: [number, number] }> = []
  const start = Math.max(0, pages.length - scanLimit)
  const seen = new Set<FrontBackMatterKind>()
  for (let i = start; i < pages.length; i += 1) {
    const candidates = headingCandidates(pages[i])
    const kind = matchPatterns(candidates, BACK_PATTERNS)
    if (!kind || seen.has(kind)) continue
    seen.add(kind)
    detected.push({ kind, pageRange: computeRunRange(pages, i, BACK_PATTERNS) })
  }
  return detected
}

const FRONT_SCAN_LIMIT_FRACTION = 0.2
const BACK_SCAN_LIMIT_FRACTION = 0.2
const MIN_SCAN_PAGES = 10

const scanLimitFor = (pages: readonly Page[], fraction: number): number => {
  if (pages.length <= MIN_SCAN_PAGES) return pages.length
  return Math.max(MIN_SCAN_PAGES, Math.ceil(pages.length * fraction))
}

const spanRange = (
  entries: ReadonlyArray<{ pageRange: [number, number] }>,
): [number, number] | undefined => {
  if (entries.length === 0) return undefined
  const lo = Math.min(...entries.map((e) => e.pageRange[0]))
  const hi = Math.max(...entries.map((e) => e.pageRange[1]))
  return [lo, hi]
}

export const classifyMatter = (book: ParsedBook): FrontBackMatter => {
  const pages = book.pages
  if (pages.length === 0) return { detected: [] }
  const front = collectFront(pages, scanLimitFor(pages, FRONT_SCAN_LIMIT_FRACTION))
  const back = collectBack(pages, scanLimitFor(pages, BACK_SCAN_LIMIT_FRACTION))
  return {
    frontMatterPageRange: spanRange(front),
    backMatterPageRange: spanRange(back),
    detected: [...front, ...back],
  }
}
