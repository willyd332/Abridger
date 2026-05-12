import 'fake-indexeddb/auto'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { deleteDB } from 'idb'

import type { Block, ParsedBook } from '@/parsers/types'

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

function bodyTextFor(blocks: Block[]): string {
  return blocks.filter((b) => b.classification === 'body').map((b) => b.text).join('\n').trim()
}

function buildFixedWindowSections(book: ParsedBook, windowPages: number) {
  const out = []
  const totalPages = book.pages.length
  let order = 1
  for (let start = 0; start < totalPages; start += windowPages) {
    const slice = book.pages.slice(start, Math.min(totalPages, start + windowPages))
    const startPage = slice[0].number
    const endPage = slice[slice.length - 1].number
    const blocks = slice.flatMap((p) => p.blocks)
    out.push({
      id: `sec-window-${String(order).padStart(3, '0')}`,
      order,
      title: `Section ${order} (pp. ${startPage}–${endPage})`,
      startPage,
      endPage,
      blocks,
      rawText: bodyTextFor(blocks),
      source: 'fixed-window' as const,
      confidence: 0.5,
    })
    order += 1
  }
  return out
}

describe('no-chapter route: fixed-window section building', () => {
  it('produces ceil(pages / windowPages) sections in order', () => {
    const pages = Array.from({ length: 55 }, (_, i) => ({
      number: i + 1,
      blocks: [
        {
          id: `${i + 1}-0`,
          text: `Page ${i + 1} body text.`,
          classification: 'body' as const,
          pageNumber: i + 1,
        },
      ],
    }))
    const book: ParsedBook = {
      id: 'no-chap',
      format: 'pdf',
      pages,
      rawText: pages.map((p) => p.blocks[0].text).join('\n'),
      matter: { detected: [] },
      warnings: [],
    }
    const sections = buildFixedWindowSections(book, 20)
    expect(sections).toHaveLength(3)
    expect(sections[0].startPage).toBe(1)
    expect(sections[0].endPage).toBe(20)
    expect(sections[1].startPage).toBe(21)
    expect(sections[1].endPage).toBe(40)
    expect(sections[2].startPage).toBe(41)
    expect(sections[2].endPage).toBe(55)
    expect(sections.every((s) => s.source === 'fixed-window')).toBe(true)
  })

  it('produces one section for a book shorter than one window', () => {
    const pages = Array.from({ length: 8 }, (_, i) => ({
      number: i + 1,
      blocks: [
        {
          id: `${i + 1}-0`,
          text: `Page ${i + 1} body.`,
          classification: 'body' as const,
          pageNumber: i + 1,
        },
      ],
    }))
    const book: ParsedBook = {
      id: 'tiny-no-chap',
      format: 'pdf',
      pages,
      rawText: pages.map((p) => p.blocks[0].text).join('\n'),
      matter: { detected: [] },
      warnings: [],
    }
    const sections = buildFixedWindowSections(book, 20)
    expect(sections).toHaveLength(1)
    expect(sections[0].startPage).toBe(1)
    expect(sections[0].endPage).toBe(8)
  })
})
