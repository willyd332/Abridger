import { describe, expect, it } from 'vitest'

import { classifyMatter } from '@/parsers/frontmatter'
import type { Block, Page, ParsedBook } from '@/parsers/types'

const bodyBlock = (id: string, text: string, page: number): Block => ({
  id,
  text,
  classification: 'body',
  pageNumber: page,
})

const page = (number: number, blocks: Block[]): Page => ({ number, blocks })

const bookFromPages = (pages: Page[]): ParsedBook => ({
  id: 'test-book',
  format: 'pdf',
  pages,
  rawText: '',
  matter: { detected: [] },
  warnings: [],
})

describe('classifyMatter', () => {
  it('returns no detections when given no pages', () => {
    const result = classifyMatter(bookFromPages([]))
    expect(result.detected).toEqual([])
    expect(result.frontMatterPageRange).toBeUndefined()
    expect(result.backMatterPageRange).toBeUndefined()
  })

  it('detects a Table of Contents in the early pages', () => {
    const pages: Page[] = []
    for (let i = 1; i <= 20; i += 1) {
      if (i === 2) {
        pages.push(
          page(i, [
            bodyBlock(`${i}-0`, 'Table of Contents', i),
            bodyBlock(`${i}-1`, 'Chapter 1 …………………………… 1', i),
            bodyBlock(`${i}-2`, 'Chapter 2 …………………………… 23', i),
          ]),
        )
      } else {
        pages.push(
          page(i, [
            bodyBlock(
              `${i}-0`,
              'Body content here that is plainly not front matter and has a proper sentence.',
              i,
            ),
          ]),
        )
      }
    }
    const result = classifyMatter(bookFromPages(pages))
    const toc = result.detected.find((d) => d.kind === 'toc')
    expect(toc).toBeDefined()
    expect(toc?.pageRange[0]).toBe(2)
    expect(result.frontMatterPageRange).toBeDefined()
  })

  it('detects an Index near the end of the book', () => {
    const pages: Page[] = []
    for (let i = 1; i <= 20; i += 1) {
      if (i === 18) {
        pages.push(
          page(i, [
            bodyBlock(`${i}-0`, 'Index', i),
            bodyBlock(`${i}-1`, 'Aristotle, 14, 22', i),
            bodyBlock(`${i}-2`, 'Plato, 9, 30', i),
          ]),
        )
      } else if (i > 18) {
        pages.push(
          page(i, [bodyBlock(`${i}-0`, 'Cicero, 41', i)]),
        )
      } else {
        pages.push(
          page(i, [
            bodyBlock(
              `${i}-0`,
              'Long-form prose that fills the body of the book at this position.',
              i,
            ),
          ]),
        )
      }
    }
    const result = classifyMatter(bookFromPages(pages))
    const index = result.detected.find((d) => d.kind === 'index')
    expect(index).toBeDefined()
    expect(index?.pageRange[0]).toBe(18)
    expect(index?.pageRange[1]).toBe(20)
    expect(result.backMatterPageRange).toEqual([18, 20])
  })

  it('detects both Preface (front) and Bibliography (back)', () => {
    const pages: Page[] = []
    for (let i = 1; i <= 30; i += 1) {
      if (i === 3) {
        pages.push(
          page(i, [
            bodyBlock(`${i}-0`, 'Preface', i),
            bodyBlock(
              `${i}-1`,
              'This book began as a series of letters, none of which were ever posted.',
              i,
            ),
          ]),
        )
      } else if (i === 28) {
        pages.push(
          page(i, [
            bodyBlock(`${i}-0`, 'Bibliography', i),
            bodyBlock(`${i}-1`, 'Smith, A. (2001). Foo. New York: Bar.', i),
          ]),
        )
      } else {
        pages.push(
          page(i, [
            bodyBlock(
              `${i}-0`,
              'A long paragraph of body prose continues unbroken across this page.',
              i,
            ),
          ]),
        )
      }
    }
    const result = classifyMatter(bookFromPages(pages))
    expect(result.detected.find((d) => d.kind === 'preface')).toBeDefined()
    expect(result.detected.find((d) => d.kind === 'bibliography')).toBeDefined()
  })
})
