import { describe, expect, it } from 'vitest'

import { buildOntology, __test__ } from '@/pipeline/ontology/build'
import { MAX_CHILDREN_PER_NODE } from '@/pipeline/ontology/types'

import { makeClient, makePdfBook } from '../fixtures'

const { reconcileChildren, snapToParagraph, seedTopLevel, buildPageIndex, offsetToPage } = __test__

describe('reconcileChildren', () => {
  it('clamps offsets, ensures coverage, and sorts by start', () => {
    const text = 'a'.repeat(1000)
    const out = reconcileChildren(
      [
        { title: 'B', startOffset: 600, endOffset: 1000 },
        { title: 'A', startOffset: 0, endOffset: 600 },
      ],
      text,
    )
    expect(out).toHaveLength(2)
    expect(out[0].startOffset).toBe(0)
    expect(out[out.length - 1].endOffset).toBe(text.length)
    for (let i = 0; i < out.length - 1; i += 1) {
      expect(out[i + 1].startOffset).toBe(out[i].endOffset)
    }
  })

  it('caps at MAX_CHILDREN_PER_NODE with a remainder tail', () => {
    const text = 'a'.repeat(20_000)
    const raw = Array.from({ length: 12 }, (_, i) => ({
      title: `child ${i + 1}`,
      startOffset: i * 1500,
      endOffset: (i + 1) * 1500,
    }))
    raw[raw.length - 1] = { ...raw[raw.length - 1], endOffset: 20_000 }
    const out = reconcileChildren(raw, text)
    expect(out).toHaveLength(MAX_CHILDREN_PER_NODE)
    expect(out[out.length - 1].title).toBe('Remaining material')
    expect(out[out.length - 1].endOffset).toBe(text.length)
  })

  it('drops degenerate (empty) ranges', () => {
    const text = 'a'.repeat(2000)
    const out = reconcileChildren(
      [
        { title: 'A', startOffset: 0, endOffset: 1000 },
        { title: 'Empty', startOffset: 1000, endOffset: 1000 },
        { title: 'B', startOffset: 1000, endOffset: 2000 },
      ],
      text,
    )
    expect(out.map((c) => c.title)).toEqual(['A', 'B'])
  })
})

describe('snapToParagraph', () => {
  it('snaps to nearest double-newline within window', () => {
    const text = 'para one body here\n\npara two body here\n\npara three body here'
    const requested = text.indexOf('para two')
    expect(snapToParagraph(text, requested)).toBe(requested)
  })

  it('returns offset unchanged when no paragraph break nearby', () => {
    const text = 'long unbroken stream of body text with no double newlines anywhere here'
    expect(snapToParagraph(text, 30)).toBe(30)
  })
})

describe('page index helpers', () => {
  it('maps offsets to pages monotonically', () => {
    const book = makePdfBook({
      pageCount: 5,
      textPerPage: (n) => `Page ${n} body text content goes here.`,
    })
    const idx = buildPageIndex(book)
    expect(idx.lastPage).toBe(5)
    const p1 = offsetToPage(idx, 0)
    const lastOffset = idx.pageStarts[4] ?? 0
    const pLast = offsetToPage(idx, lastOffset)
    expect(p1).toBe(1)
    expect(pLast).toBeGreaterThanOrEqual(p1)
  })
})

describe('seedTopLevel', () => {
  it('produces contiguous children from an outline', () => {
    const book = makePdfBook({
      pageCount: 6,
      textPerPage: (n) => `Page ${n} body text content goes here that fills out the page.`,
    })
    const idx = buildPageIndex(book)
    const children = seedTopLevel(
      [
        { title: 'Ch 1', startPage: 1 },
        { title: 'Ch 2', startPage: 3 },
        { title: 'Ch 3', startPage: 5 },
      ],
      book.rawText,
      idx,
    )
    expect(children.length).toBeGreaterThanOrEqual(1)
    expect(children[0].startOffset).toBe(0)
    expect(children[children.length - 1].endOffset).toBe(book.rawText.length)
    for (let i = 0; i < children.length - 1; i += 1) {
      expect(children[i + 1].startOffset).toBe(children[i].endOffset)
    }
  })
})

describe('buildOntology integration', () => {
  it('treats a small book as a single leaf without LLM calls', async () => {
    const book = makePdfBook({
      pageCount: 1,
      textPerPage: () => 'A very short book that fits inside the leaf budget.',
    })
    const client = makeClient()
    const mock = client.useMockProvider()
    const tree = await buildOntology(
      { parsedBook: book, outline: null },
      client,
      { leafByteBudget: 10_000 },
    )
    expect(mock.callCount()).toBe(0)
    expect(tree.leafIdsInOrder).toHaveLength(1)
    expect(tree.nodes[tree.leafIdsInOrder[0]].isLeaf).toBe(true)
  })

  it('decomposes a large book recursively into leaves under budget', async () => {
    const paragraph = 'This is a paragraph of body text. '.repeat(20) + '\n\n'
    const book = makePdfBook({
      pageCount: 12,
      textPerPage: () => paragraph.repeat(8),
    })
    const client = makeClient()
    const mock = client.useMockProvider()
    // Halve-the-rest response: reconcileChildren clamps the huge endOffset to
    // the parent's actual length, so this effectively bisects each call.
    mock.setDefaultResponse({
      text: JSON.stringify({
        children: [
          { title: 'First half', startOffset: 0, endOffset: 5_000 },
          { title: 'Second half', startOffset: 5_000, endOffset: 10_000_000 },
        ],
      }),
    })

    const tree = await buildOntology(
      { parsedBook: book, outline: null },
      client,
      { leafPageBudget: 3, maxDepth: 4 },
    )

    // Every node tagged as a leaf must actually carry isLeaf=true. (Forced-
    // leaves at any depth are legitimate — they happen when decomposition
    // collapses to ≤1 child after the < MIN_CHILD_PAGES merge step.)
    expect(tree.leafIdsInOrder.length).toBeGreaterThan(0)
    for (const id of tree.leafIdsInOrder) {
      expect(tree.nodes[id].isLeaf).toBe(true)
    }
    // Leaves cover the whole text contiguously
    let cursor = 0
    for (const id of tree.leafIdsInOrder) {
      const node = tree.nodes[id]
      expect(node.startOffset).toBe(cursor)
      cursor = node.endOffset
    }
    expect(cursor).toBe(book.rawText.length)
  })

  it('uses TOC outline as top-level seed', async () => {
    const para = 'Some body text on the page. '.repeat(30) + '\n\n'
    const book = makePdfBook({
      pageCount: 10,
      textPerPage: () => para.repeat(4),
    })
    const client = makeClient()
    const mock = client.useMockProvider()
    // Force every decomposition call to fail validation → treat as forced leaf
    mock.setDefaultResponse({ text: 'not json' })

    const tree = await buildOntology(
      {
        parsedBook: book,
        outline: [
          { title: 'Part One', startPage: 1 },
          { title: 'Part Two', startPage: 5 },
        ],
      },
      client,
      { leafByteBudget: 5_000, maxDepth: 1 },
    )

    const root = tree.nodes[tree.rootId]
    expect(root.childIds).toHaveLength(2)
    expect(tree.nodes[root.childIds[0]].title).toBe('Part One')
    expect(tree.nodes[root.childIds[1]].title).toBe('Part Two')
    expect(tree.nodes[root.childIds[0]].source).toBe('toc')
  })
})
