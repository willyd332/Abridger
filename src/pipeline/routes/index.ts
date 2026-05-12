import type { ParsedBook } from '@/parsers/types'
import type { RouteName } from '@/state/types'

const SHORT_BOOK_MAX_PAGES = 100
const LONG_BOOK_MIN_PAGES = 1500
const LONG_BOOK_MIN_SECTIONS = 60
const CHARS_PER_TOKEN = 4
const SMART_CONTEXT_TOKENS = 200_000
const SHORT_BOOK_TOKEN_BUDGET = SMART_CONTEXT_TOKENS * 0.5

export type RouteDetection = {
  route: RouteName
  reason: string
}

function estimateTokens(book: ParsedBook): number {
  return Math.max(1, Math.ceil(book.rawText.length / CHARS_PER_TOKEN))
}

function estimateSectionCount(book: ParsedBook): number {
  if (book.spine && book.spine.length > 0) return book.spine.length
  if (book.matter.detected.length > 0) {
    return Math.max(1, book.matter.detected.length)
  }
  return Math.max(1, Math.ceil(book.pages.length / 25))
}

export function detectRoute(book: ParsedBook): RouteDetection {
  const pageCount = book.pages.length
  const tokenCount = estimateTokens(book)
  const sectionCount = estimateSectionCount(book)

  if (pageCount < SHORT_BOOK_MAX_PAGES && tokenCount < SHORT_BOOK_TOKEN_BUDGET) {
    return {
      route: 'short-book',
      reason: `Short book: ${pageCount} pages, ~${tokenCount.toLocaleString()} tokens; fits in a single smart-model call.`,
    }
  }

  if (pageCount > LONG_BOOK_MIN_PAGES || sectionCount > LONG_BOOK_MIN_SECTIONS) {
    return {
      route: 'long-book',
      reason: `Long book: ${pageCount} pages, ~${sectionCount} sections; using hierarchical macro filter.`,
    }
  }

  return {
    route: 'normal-book',
    reason: `Normal book: ${pageCount} pages, ~${sectionCount} sections; standard pipeline.`,
  }
}

export { executeNormalBookRoute } from './normal-book'
export { executeShortBookRoute } from './short-book'
export { executeLongBookRoute } from './long-book'
export { executeNoChapterBookRoute } from './no-chapter-book'

export type {
  RouteContext,
  RouteOutput,
} from './route-shared'
