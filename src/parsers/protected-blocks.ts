import type { Block } from './types'

const MONOSPACE_FONT_HINTS = ['mono', 'courier', 'consolas', 'menlo']
const MATH_FONT_HINTS = ['cmsy', 'cmmi', 'cmex', 'mtsy', 'msam', 'msbm', 'stix']

const SHORT_LINE_THRESHOLD = 60
const VERSE_RUN_MIN = 3
const VERSE_DENSITY_THRESHOLD = 0.4
const CAST_LIST_PARAGRAPH_MAX = 100

const CAST_HEADING_RE =
  /^(dramatis personae|cast of characters|cast|characters|personae)\b/i

const SENTENCE_TERMINAL_RE = /[.!?…)"”'’\]]\s*$/

const FOOTNOTE_START_RE = /^[¹²³⁰-⁹*†‡]|^\s*\d{1,3}[.)]\s+\S/

type FontHint = string | undefined

const fontHintMatches = (fontHint: FontHint, needles: string[]): boolean => {
  if (!fontHint) return false
  const lower = fontHint.toLowerCase()
  return needles.some((needle) => lower.includes(needle))
}

const isShortNonTerminated = (text: string): boolean => {
  const trimmed = text.trim()
  if (!trimmed) return false
  if (trimmed.length >= SHORT_LINE_THRESHOLD) return false
  if (SENTENCE_TERMINAL_RE.test(trimmed)) return false
  return true
}

const looksLikeVerseRun = (blocks: Block[], start: number, end: number): boolean => {
  const length = end - start
  if (length < VERSE_RUN_MIN) return false
  let shortCount = 0
  for (let i = start; i < end; i += 1) {
    if (isShortNonTerminated(blocks[i].text)) shortCount += 1
  }
  return shortCount / length >= VERSE_DENSITY_THRESHOLD
}

const findVerseRuns = (blocks: Block[]): Array<[number, number]> => {
  const runs: Array<[number, number]> = []
  let runStart: number | null = null
  for (let i = 0; i < blocks.length; i += 1) {
    const block = blocks[i]
    if (block.classification !== 'body') {
      if (runStart !== null) {
        if (looksLikeVerseRun(blocks, runStart, i)) runs.push([runStart, i])
        runStart = null
      }
      continue
    }
    if (isShortNonTerminated(block.text)) {
      if (runStart === null) runStart = i
    } else {
      if (runStart !== null) {
        if (looksLikeVerseRun(blocks, runStart, i)) runs.push([runStart, i])
        runStart = null
      }
    }
  }
  if (runStart !== null && looksLikeVerseRun(blocks, runStart, blocks.length)) {
    runs.push([runStart, blocks.length])
  }
  return runs
}

const findCastListRuns = (blocks: Block[]): Array<[number, number]> => {
  const runs: Array<[number, number]> = []
  for (let i = 0; i < blocks.length; i += 1) {
    if (!CAST_HEADING_RE.test(blocks[i].text.trim())) continue
    let end = i + 1
    while (end < blocks.length) {
      const next = blocks[end]
      if (next.classification !== 'body') break
      if (next.text.trim().length === 0) break
      if (next.text.trim().length > CAST_LIST_PARAGRAPH_MAX) break
      end += 1
    }
    if (end - i >= 2) runs.push([i, end])
  }
  return runs
}

type FontLookup = (block: Block) => FontHint

const defaultFontLookup: FontLookup = () => undefined

export type ProtectBlocksOptions = {
  fontLookup?: FontLookup
}

const isMonospaceBlock = (block: Block, fontLookup: FontLookup): boolean => {
  return fontHintMatches(fontLookup(block), MONOSPACE_FONT_HINTS)
}

const isMathBlock = (block: Block, fontLookup: FontLookup): boolean => {
  return fontHintMatches(fontLookup(block), MATH_FONT_HINTS)
}

const cloneAsProtected = (block: Block): Block =>
  block.classification === 'protected' ? block : { ...block, classification: 'protected' }

export const classifyProtected = (
  blocks: readonly Block[],
  options: ProtectBlocksOptions = {},
): Block[] => {
  const fontLookup = options.fontLookup ?? defaultFontLookup
  const working: Block[] = blocks.map((b) => ({ ...b }))

  const verseRuns = findVerseRuns(working)
  for (const [start, end] of verseRuns) {
    for (let i = start; i < end; i += 1) {
      working[i] = cloneAsProtected(working[i])
    }
  }

  const castRuns = findCastListRuns(working)
  for (const [start, end] of castRuns) {
    for (let i = start; i < end; i += 1) {
      working[i] = cloneAsProtected(working[i])
    }
  }

  for (let i = 0; i < working.length; i += 1) {
    const block = working[i]
    if (block.classification !== 'body') continue
    if (isMonospaceBlock(block, fontLookup) || isMathBlock(block, fontLookup)) {
      working[i] = cloneAsProtected(block)
    }
  }

  return working
}

export const __test = {
  isShortNonTerminated,
  looksLikeVerseRun,
  findVerseRuns,
  findCastListRuns,
  FOOTNOTE_START_RE,
}
