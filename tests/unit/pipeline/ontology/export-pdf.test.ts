import { describe, expect, it } from 'vitest'

import { buildFragments } from '@/pipeline/ontology/export'
import { __test__ } from '@/pipeline/ontology/export-pdf'
import type { OntologyNode, OntologyTree } from '@/pipeline/ontology/types'

const { preflightPageData, resolveDeletionIntervals } = __test__

function makeLeaf(
  id: string,
  parentId: string,
  order: number,
  depth: number,
  startOffset: number,
  endOffset: number,
  startPage: number | null,
  endPage: number | null,
): OntologyNode {
  return {
    id,
    parentId,
    childIds: [],
    order,
    depth,
    title: id,
    startOffset,
    endOffset,
    startPage,
    endPage,
    isLeaf: true,
    source: 'llm-decomposed',
    summary: null,
  }
}

function makeInternal(
  id: string,
  parentId: string | null,
  order: number,
  depth: number,
  childIds: string[],
  startOffset: number,
  endOffset: number,
  startPage: number | null = 1,
  endPage: number | null = 1,
): OntologyNode {
  return {
    id,
    parentId,
    childIds,
    order,
    depth,
    title: id,
    startOffset,
    endOffset,
    startPage,
    endPage,
    isLeaf: false,
    source: parentId === null ? 'root' : 'llm-decomposed',
    summary: null,
  }
}

// Four-leaf tree spanning 4000 bytes / pages 1..20.
// Each leaf covers 5 pages with disjoint page ranges:
//   a1: pp. 1–5, a2: pp. 6–10, b1: pp. 11–15, b2: pp. 16–20
function makeDisjointTree(): OntologyTree {
  const nodes: Record<string, OntologyNode> = {}
  nodes.root = makeInternal('root', null, 0, 0, ['A', 'B'], 0, 4000, 1, 20)
  nodes.A = makeInternal('A', 'root', 0, 1, ['a1', 'a2'], 0, 2000, 1, 10)
  nodes.B = makeInternal('B', 'root', 1, 1, ['b1', 'b2'], 2000, 4000, 11, 20)
  nodes.a1 = makeLeaf('a1', 'A', 0, 2, 0, 1000, 1, 5)
  nodes.a2 = makeLeaf('a2', 'A', 1, 2, 1000, 2000, 6, 10)
  nodes.b1 = makeLeaf('b1', 'B', 0, 2, 2000, 3000, 11, 15)
  nodes.b2 = makeLeaf('b2', 'B', 1, 2, 3000, 4000, 16, 20)
  return {
    rootId: 'root',
    nodes,
    leafIdsInOrder: ['a1', 'a2', 'b1', 'b2'],
    totalChars: 4000,
    builtAt: 0,
  }
}

// Same tree but with boundary-page overlaps between leaves:
//   a1: pp. 1–7, a2: pp. 7–9, b1: pp. 9–13, b2: pp. 13–20
// Pages 7, 9, 13 each appear in two leaves.
function makeOverlapTree(): OntologyTree {
  const nodes: Record<string, OntologyNode> = {}
  nodes.root = makeInternal('root', null, 0, 0, ['A', 'B'], 0, 4000, 1, 20)
  nodes.A = makeInternal('A', 'root', 0, 1, ['a1', 'a2'], 0, 2000, 1, 9)
  nodes.B = makeInternal('B', 'root', 1, 1, ['b1', 'b2'], 2000, 4000, 9, 20)
  nodes.a1 = makeLeaf('a1', 'A', 0, 2, 0, 1000, 1, 7)
  nodes.a2 = makeLeaf('a2', 'A', 1, 2, 1000, 2000, 7, 9)
  nodes.b1 = makeLeaf('b1', 'B', 0, 2, 2000, 3000, 9, 13)
  nodes.b2 = makeLeaf('b2', 'B', 1, 2, 3000, 4000, 13, 20)
  return {
    rootId: 'root',
    nodes,
    leafIdsInOrder: ['a1', 'a2', 'b1', 'b2'],
    totalChars: 4000,
    builtAt: 0,
  }
}

describe('resolveDeletionIntervals', () => {
  it('returns no intervals when every leaf is kept', () => {
    const tree = makeDisjointTree()
    const inclusion: Record<string, boolean> = {}
    const fragments = buildFragments(tree, inclusion)
    const intervals = resolveDeletionIntervals(fragments, tree, 20, 0)
    expect(intervals).toEqual([])
  })

  it('deletes one leaf range when one leaf is excluded', () => {
    const tree = makeDisjointTree()
    const inclusion: Record<string, boolean> = { a1: false }
    const fragments = buildFragments(tree, inclusion)
    const intervals = resolveDeletionIntervals(fragments, tree, 20, 0)
    expect(intervals).toEqual([{ nodeId: 'a1', startPageIdx: 0, endPageIdx: 4 }])
  })

  it('keeps preamble pages untouched when pageOffset > 0', () => {
    // Original PDF has 25 pages; logical page 1 = original page 6.
    // Excluding a1 (logical pp. 1–5) should delete original pages 6–10
    // (0-indexed: 5–9) and leave 0–4 (preamble) plus 10–24 untouched.
    const tree = makeDisjointTree()
    const inclusion: Record<string, boolean> = { a1: false }
    const fragments = buildFragments(tree, inclusion)
    const intervals = resolveDeletionIntervals(fragments, tree, 25, 5)
    expect(intervals).toEqual([{ nodeId: 'a1', startPageIdx: 5, endPageIdx: 9 }])
  })

  it('emits two disjoint intervals for two non-adjacent exclusions', () => {
    const tree = makeDisjointTree()
    const inclusion: Record<string, boolean> = { a1: false, b2: false }
    const fragments = buildFragments(tree, inclusion)
    const intervals = resolveDeletionIntervals(fragments, tree, 20, 0)
    expect(intervals).toEqual([
      { nodeId: 'a1', startPageIdx: 0, endPageIdx: 4 },
      { nodeId: 'b2', startPageIdx: 15, endPageIdx: 19 },
    ])
  })

  it('keep wins on boundary-page overlap (excluded a1, kept a2 share page 7)', () => {
    // a1: pp. 1–7 excluded, a2: pp. 7–9 kept.
    // Page 7 is claimed by both, but keep wins, so the deletion interval is
    // only pp. 1–6 (0-indexed 0–5). a2's pages 7–9 (idx 6–8) survive.
    const tree = makeOverlapTree()
    const inclusion: Record<string, boolean> = { a1: false }
    const fragments = buildFragments(tree, inclusion)
    const intervals = resolveDeletionIntervals(fragments, tree, 20, 0)
    expect(intervals).toEqual([{ nodeId: 'a1', startPageIdx: 0, endPageIdx: 5 }])
  })

  it('keep wins on both boundaries of an excluded middle section', () => {
    // a2: pp. 7–9 excluded; a1 (pp. 1–7) and b1 (pp. 9–13) are kept.
    // Page 7 belongs to a1 ∩ a2; page 9 belongs to a2 ∩ b1.
    // Both boundary pages keep-win. a2's exclusive page is page 8 only.
    const tree = makeOverlapTree()
    const inclusion: Record<string, boolean> = { a2: false }
    const fragments = buildFragments(tree, inclusion)
    const intervals = resolveDeletionIntervals(fragments, tree, 20, 0)
    expect(intervals).toEqual([{ nodeId: 'a2', startPageIdx: 7, endPageIdx: 7 }])
  })

  it('drops the bracket entirely when every page is shadowed by a kept neighbor', () => {
    // a2: pp. 7–9 — every page also appears in a1 or b1.
    // Construct a tree where a2 is the only excluded leaf AND every page
    // a2 covers overlaps a kept neighbor's range.
    const nodes: Record<string, OntologyNode> = {}
    nodes.root = makeInternal('root', null, 0, 0, ['A', 'B'], 0, 4000, 1, 20)
    nodes.A = makeInternal('A', 'root', 0, 1, ['a1', 'a2'], 0, 2000, 1, 9)
    nodes.B = makeInternal('B', 'root', 1, 1, ['b1'], 2000, 4000, 7, 20)
    nodes.a1 = makeLeaf('a1', 'A', 0, 2, 0, 1000, 1, 9)
    nodes.a2 = makeLeaf('a2', 'A', 1, 2, 1000, 2000, 7, 9)
    nodes.b1 = makeLeaf('b1', 'B', 0, 2, 2000, 4000, 7, 20)
    const tree: OntologyTree = {
      rootId: 'root',
      nodes,
      leafIdsInOrder: ['a1', 'a2', 'b1'],
      totalChars: 4000,
      builtAt: 0,
    }
    const inclusion: Record<string, boolean> = { a2: false }
    const fragments = buildFragments(tree, inclusion)
    const intervals = resolveDeletionIntervals(fragments, tree, 20, 0)
    expect(intervals).toEqual([])
  })

  it('collapses adjacent excluded leaves into one interval after fragment merging', () => {
    // a1 and a2 both excluded; their fragments merge in buildFragments and
    // their page ranges (1–5, 6–10) are contiguous → one interval 0..9.
    const tree = makeDisjointTree()
    const inclusion: Record<string, boolean> = { a1: false, a2: false }
    const fragments = buildFragments(tree, inclusion)
    const intervals = resolveDeletionIntervals(fragments, tree, 20, 0)
    expect(intervals).toHaveLength(1)
    expect(intervals[0].startPageIdx).toBe(0)
    expect(intervals[0].endPageIdx).toBe(9)
  })
})

describe('preflightPageData', () => {
  it('passes when every overlapping leaf has page data', () => {
    const tree = makeDisjointTree()
    const fragments = buildFragments(tree, { a1: false })
    expect(() => preflightPageData(fragments, tree)).not.toThrow()
  })

  it('throws when an excluded leaf has null startPage', () => {
    const tree = makeDisjointTree()
    tree.nodes.a1 = { ...tree.nodes.a1, startPage: null }
    const fragments = buildFragments(tree, { a1: false })
    expect(() => preflightPageData(fragments, tree)).toThrow(
      /missing page data/,
    )
  })

  it('throws when a kept leaf overlapping a fragment has null endPage', () => {
    // Even kept leaves are checked, because the resolver needs their page
    // range to compute the kept-pages set for the keep-wins rule.
    const tree = makeDisjointTree()
    tree.nodes.a2 = { ...tree.nodes.a2, endPage: null }
    const fragments = buildFragments(tree, { a1: false })
    expect(() => preflightPageData(fragments, tree)).toThrow(
      /missing page data/,
    )
  })
})
