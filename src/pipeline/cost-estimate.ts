import type { ParsedBook } from '@/parsers/types'
import { computeCostUsd } from '@/llm/pricing'
import type { Provider, ProviderModelMap, Role } from '@/llm/types'
import type { RouteName } from '@/state/types'

const CHARS_PER_TOKEN = 4
const RANGE_MULTIPLIER = 0.3
const PDF_WINDOW_PAGES = 10
const AVG_BLOCKS_PER_PAGE = 15
const DEFAULT_SECTIONS_FALLBACK = 12
const NORMAL_BOOK_SECTIONS_ESTIMATE = 25
const LONG_BOOK_SECTIONS_ESTIMATE = 80
const SHORT_BOOK_OUT_TOKENS = 16000
const BRACKET_MEAN_TOKENS_OUT = 300
const KEEP_BRACKET_PROB = 0.3
const SANITY_FRACTION = 0.5

export type PhaseCostRange = {
  minUsd: number
  maxUsd: number
}

export type CostEstimate = {
  minUsd: number
  maxUsd: number
  perPhase: Record<string, PhaseCostRange>
  assumptions: string[]
}

function estimateTokensFromChars(chars: number): number {
  return Math.max(1, Math.ceil(chars / CHARS_PER_TOKEN))
}

function rangeAround(centerUsd: number): PhaseCostRange {
  const min = Math.max(0, centerUsd * (1 - RANGE_MULTIPLIER))
  const max = centerUsd * (1 + RANGE_MULTIPLIER)
  return { minUsd: min, maxUsd: max }
}

function addRange(a: PhaseCostRange, b: PhaseCostRange): PhaseCostRange {
  return { minUsd: a.minUsd + b.minUsd, maxUsd: a.maxUsd + b.maxUsd }
}

function modelForRole(modelMapping: ProviderModelMap, role: Role): string {
  return modelMapping[role]
}

function estimateSectionCount(book: ParsedBook, route: RouteName): number {
  if (route === 'short-book') return 1
  if (route === 'long-book') return LONG_BOOK_SECTIONS_ESTIMATE
  if (route === 'no-chapter-book') {
    const totalTokens = estimateTokensFromChars(book.rawText.length)
    const sectionsByText = Math.max(1, Math.ceil(totalTokens / 10000))
    const sectionsByPages = Math.max(1, Math.ceil(book.pages.length / 20))
    return Math.max(sectionsByText, sectionsByPages, 1)
  }
  const fromOutline = book.spine?.length ?? 0
  if (fromOutline > 0) return fromOutline
  const fromPages = Math.max(1, Math.ceil(book.pages.length / 25))
  return Math.max(fromPages, DEFAULT_SECTIONS_FALLBACK)
}

function estimateShortBook(
  book: ParsedBook,
  provider: Provider,
  modelMapping: ProviderModelMap,
): CostEstimate {
  const smartModel = modelForRole(modelMapping, 'smart')
  const inTokens = estimateTokensFromChars(book.rawText.length)
  const center = computeCostUsd(provider, smartModel, inTokens, SHORT_BOOK_OUT_TOKENS)
  const phaseRange = rangeAround(center)
  return {
    minUsd: phaseRange.minUsd,
    maxUsd: phaseRange.maxUsd,
    perPhase: { 'short-book-single-call': phaseRange },
    assumptions: [
      `Short-book route: one ${smartModel} call covering the entire book.`,
      `Estimated ${inTokens.toLocaleString()} input tokens; ~${SHORT_BOOK_OUT_TOKENS.toLocaleString()} output tokens.`,
      'Range is ±30% around the central estimate.',
    ],
  }
}

function estimatePhaseA(
  book: ParsedBook,
  provider: Provider,
  modelMapping: ProviderModelMap,
  route: RouteName,
): { range: PhaseCostRange; note: string } {
  const cheapModel = modelForRole(modelMapping, 'cheap')
  if (book.format === 'epub') {
    const spineCount = book.spine?.length ?? 1
    const perCall = computeCostUsd(provider, cheapModel, 1500, 400)
    const center = perCall * Math.max(1, spineCount)
    return {
      range: rangeAround(center),
      note: `Phase A: assumes ~${spineCount} EPUB spine item${spineCount === 1 ? '' : 's'} via ${cheapModel}.`,
    }
  }
  if (route === 'no-chapter-book') {
    return {
      range: { minUsd: 0, maxUsd: 0 },
      note: 'Phase A skipped: no-chapter route uses fixed-window sections.',
    }
  }
  const pageCount = book.pages.length
  const windows = Math.max(1, Math.ceil(pageCount / PDF_WINDOW_PAGES))
  const tokensPerWindow = PDF_WINDOW_PAGES * AVG_BLOCKS_PER_PAGE * 25
  const perWindow = computeCostUsd(provider, cheapModel, tokensPerWindow, 400)
  const center = perWindow * windows
  return {
    range: rangeAround(center),
    note: `Phase A: ${windows} 10-page windows via ${cheapModel}.`,
  }
}

function estimatePhaseA5(
  provider: Provider,
  modelMapping: ProviderModelMap,
): { range: PhaseCostRange; note: string } {
  const cheapModel = modelForRole(modelMapping, 'cheap')
  const center = computeCostUsd(provider, cheapModel, 800, 500)
  return {
    range: rangeAround(center),
    note: `Phase A.5: one ${cheapModel} call to list canonical passages.`,
  }
}

function estimatePhaseB(
  book: ParsedBook,
  provider: Provider,
  modelMapping: ProviderModelMap,
  sectionCount: number,
): { range: PhaseCostRange; note: string } {
  const smartModel = modelForRole(modelMapping, 'smart')
  const charsPerSection = Math.max(1, Math.ceil(book.rawText.length / Math.max(1, sectionCount)))
  const tokensPerSection = estimateTokensFromChars(charsPerSection)
  const perCall = computeCostUsd(provider, smartModel, tokensPerSection, 300)
  const center = perCall * sectionCount
  return {
    range: rangeAround(center),
    note: `Phase B: ${sectionCount} sections, ~${tokensPerSection.toLocaleString()} input tokens each via ${smartModel}.`,
  }
}

function estimatePhaseB5(
  provider: Provider,
  modelMapping: ProviderModelMap,
  sectionCount: number,
): { range: PhaseCostRange; note: string } {
  const smartModel = modelForRole(modelMapping, 'smart')
  const inTokens = Math.max(1000, sectionCount * 200)
  const center = computeCostUsd(provider, smartModel, inTokens, 600)
  return {
    range: rangeAround(center),
    note: `Phase B.5: one ${smartModel} call over section summaries.`,
  }
}

function estimatePhaseC1(
  provider: Provider,
  modelMapping: ProviderModelMap,
  sectionCount: number,
  route: RouteName,
): { range: PhaseCostRange; note: string } {
  const reasoningModel = modelForRole(modelMapping, 'reasoning')
  if (route === 'long-book') {
    const partsCount = Math.max(1, Math.ceil(sectionCount / 10))
    const partLevelTokens = Math.max(2000, partsCount * 400)
    const partLevel = computeCostUsd(provider, reasoningModel, partLevelTokens, 800)
    const keptParts = Math.ceil(partsCount * 0.6)
    const perKeptPart = computeCostUsd(provider, reasoningModel, partLevelTokens, 800)
    const center = partLevel + keptParts * perKeptPart
    return {
      range: rangeAround(center),
      note: `Phase C1 (long-book hierarchical): ${partsCount} parts; ${reasoningModel} part-level + per-kept-part.`,
    }
  }
  const inTokens = Math.max(2000, sectionCount * 400)
  const outTokens = Math.max(800, sectionCount * 80)
  const center = computeCostUsd(provider, reasoningModel, inTokens, outTokens)
  return {
    range: rangeAround(center),
    note: `Phase C1: macro filter via ${reasoningModel}.`,
  }
}

function estimatePhaseC15(
  provider: Provider,
  modelMapping: ProviderModelMap,
  sectionCount: number,
): { range: PhaseCostRange; note: string } {
  const reasoningModel = modelForRole(modelMapping, 'reasoning')
  const calls = Math.ceil(sectionCount * SANITY_FRACTION)
  const perCall = computeCostUsd(provider, reasoningModel, 2500, 200)
  const center = perCall * calls
  return {
    range: rangeAround(center),
    note: `Phase C1.5: ~${calls} sanity calls (≈half of sections) via ${reasoningModel}.`,
  }
}

function estimatePhaseC2(
  book: ParsedBook,
  provider: Provider,
  modelMapping: ProviderModelMap,
  sectionCount: number,
): { range: PhaseCostRange; note: string } {
  const smartModel = modelForRole(modelMapping, 'smart')
  const keptSections = Math.max(1, Math.ceil(sectionCount * 0.7))
  const charsPerSection = Math.max(1, Math.ceil(book.rawText.length / Math.max(1, sectionCount)))
  const tokensPerSection = estimateTokensFromChars(charsPerSection)
  const perCall = computeCostUsd(provider, smartModel, tokensPerSection, 500)
  const center = perCall * keptSections
  return {
    range: rangeAround(center),
    note: `Phase C2: micro filter on ~${keptSections} kept sections via ${smartModel}.`,
  }
}

function estimateBracketWriter(
  provider: Provider,
  modelMapping: ProviderModelMap,
  sectionCount: number,
): { range: PhaseCostRange; note: string } {
  const smartModel = modelForRole(modelMapping, 'smart')
  const macroBrackets = Math.ceil(sectionCount * KEEP_BRACKET_PROB)
  const microBrackets = sectionCount * 2
  const totalCuts = macroBrackets + microBrackets
  const perBracket = computeCostUsd(provider, smartModel, 1200, BRACKET_MEAN_TOKENS_OUT)
  const center = perBracket * totalCuts
  return {
    range: rangeAround(center),
    note: `Bracket-writer: ~${totalCuts} brackets via ${smartModel}.`,
  }
}

export function estimateCost(
  book: ParsedBook,
  provider: Provider,
  modelMapping: ProviderModelMap,
  route: RouteName,
): CostEstimate {
  if (route === 'short-book') {
    return estimateShortBook(book, provider, modelMapping)
  }

  const sectionCount =
    route === 'normal-book'
      ? Math.max(estimateSectionCount(book, route), NORMAL_BOOK_SECTIONS_ESTIMATE)
      : estimateSectionCount(book, route)

  const a = estimatePhaseA(book, provider, modelMapping, route)
  const a5 = estimatePhaseA5(provider, modelMapping)
  const b = estimatePhaseB(book, provider, modelMapping, sectionCount)
  const b5 = estimatePhaseB5(provider, modelMapping, sectionCount)
  const c1 = estimatePhaseC1(provider, modelMapping, sectionCount, route)
  const c15 = estimatePhaseC15(provider, modelMapping, sectionCount)
  const c2 = estimatePhaseC2(book, provider, modelMapping, sectionCount)
  const bracket = estimateBracketWriter(provider, modelMapping, sectionCount)

  const perPhase: Record<string, PhaseCostRange> = {
    A: a.range,
    A5: a5.range,
    B: b.range,
    B5: b5.range,
    C1: c1.range,
    C15: c15.range,
    C2: c2.range,
    'bracket-writer': bracket.range,
  }

  const total = Object.values(perPhase).reduce<PhaseCostRange>(
    (acc, r) => addRange(acc, r),
    { minUsd: 0, maxUsd: 0 },
  )

  const assumptions = [
    `Route: ${route}.`,
    `Assumes ~${sectionCount} sections.`,
    'Assumes ~30% of sections are bracketed at the macro level; 2 micro cuts per kept section.',
    'Token estimates use 4 characters per token as a heuristic.',
    'Per-phase ranges are ±30% around the central estimate.',
    a.note,
    a5.note,
    b.note,
    b5.note,
    c1.note,
    c15.note,
    c2.note,
    bracket.note,
  ]

  return {
    minUsd: total.minUsd,
    maxUsd: total.maxUsd,
    perPhase,
    assumptions,
  }
}
