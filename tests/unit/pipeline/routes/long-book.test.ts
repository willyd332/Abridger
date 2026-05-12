import 'fake-indexeddb/auto'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { deleteDB } from 'idb'

import type { ParsedBook } from '@/parsers/types'

import { detectRoute } from '@/pipeline/routes'

import { DB_NAME, closeDb, resetDbForTests } from '@/state/db'

async function resetDb(): Promise<void> {
  await closeDb()
  await deleteDB(DB_NAME)
  resetDbForTests()
}

beforeEach(async () => {
  await resetDb()
})

afterEach(async () => {
  await resetDb()
})

function makeLongBook(): ParsedBook {
  // EPUB with 80 spine items, 300 pages — triggers long-book by section count.
  const spineCount = 80
  const spineItems = Array.from({ length: spineCount }, (_, i) => ({
    id: `sec-${i}`,
    href: `sec-${i}.xhtml`,
    mediaType: 'application/xhtml+xml',
  }))
  const pageCount = 300
  const pages = Array.from({ length: pageCount }, (_, i) => ({
    number: i + 1,
    blocks: [
      {
        id: `${i + 1}-0`,
        text: `Page ${i + 1} body text. Some prose here for the long book test fixture.`,
        classification: 'body' as const,
        pageNumber: i + 1,
        spineItemId: `sec-${Math.floor((i / pageCount) * spineCount)}`,
      },
    ],
  }))
  return {
    id: 'long-book-test',
    format: 'epub',
    title: 'A Long Book',
    pages,
    rawText: pages.map((p) => p.blocks.map((b) => b.text).join('\n')).join('\n'),
    matter: { detected: [] },
    spine: spineItems,
    epubVersion: '3.0',
    warnings: [],
  }
}

describe('detectRoute (long-book)', () => {
  it('selects long-book for > 60 spine sections', () => {
    const book = makeLongBook()
    const detection = detectRoute(book)
    expect(detection.route).toBe('long-book')
  })

  it('selects long-book for page count > 1500 even with few sections', () => {
    const pages = Array.from({ length: 1600 }, (_, i) => ({
      number: i + 1,
      blocks: [
        {
          id: `${i + 1}-0`,
          text: `Page ${i + 1} of a very long book.`,
          classification: 'body' as const,
          pageNumber: i + 1,
        },
      ],
    }))
    const book: ParsedBook = {
      id: 'long-by-pages',
      format: 'pdf',
      pages,
      rawText: pages.map((p) => p.blocks[0].text).join('\n'),
      matter: { detected: [] },
      warnings: [],
    }
    const detection = detectRoute(book)
    expect(detection.route).toBe('long-book')
  })
})
