import { describe, expect, it } from 'vitest'

import { buildFragments } from '@/pipeline/ontology/export'
import {
  bytesToLengthHint,
  type OntologyNode,
  type OntologyTree,
} from '@/pipeline/ontology/types'

function makeLeaf(
  id: string,
  parentId: string,
  order: number,
  depth: number,
  startOffset: number,
  endOffset: number,
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
    startPage: 1,
    endPage: 1,
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
    startPage: 1,
    endPage: 1,
    isLeaf: false,
    source: parentId === null ? 'root' : 'llm-decomposed',
    summary: null,
  }
}

function makeTree(): OntologyTree {
  // root → [A → [a1, a2], B → [b1, b2]]
  const nodes: Record<string, OntologyNode> = {}
  nodes.root = makeInternal('root', null, 0, 0, ['A', 'B'], 0, 4000)
  nodes.A = makeInternal('A', 'root', 0, 1, ['a1', 'a2'], 0, 2000)
  nodes.B = makeInternal('B', 'root', 1, 1, ['b1', 'b2'], 2000, 4000)
  nodes.a1 = makeLeaf('a1', 'A', 0, 2, 0, 1000)
  nodes.a2 = makeLeaf('a2', 'A', 1, 2, 1000, 2000)
  nodes.b1 = makeLeaf('b1', 'B', 0, 2, 2000, 3000)
  nodes.b2 = makeLeaf('b2', 'B', 1, 2, 3000, 4000)
  return {
    rootId: 'root',
    nodes,
    leafIdsInOrder: ['a1', 'a2', 'b1', 'b2'],
    totalChars: 4000,
    builtAt: 0,
  }
}

describe('buildFragments', () => {
  it('returns one keep fragment when all leaves included', () => {
    const tree = makeTree()
    const inclusion: Record<string, boolean> = {
      a1: true,
      a2: true,
      b1: true,
      b2: true,
    }
    const frags = buildFragments(tree, inclusion)
    expect(frags).toHaveLength(1)
    expect(frags[0].kind).toBe('keep')
    expect(frags[0].nodeId).toBe('root')
    expect(frags[0].startOffset).toBe(0)
    expect(frags[0].endOffset).toBe(4000)
  })

  it('returns one bracket fragment when all leaves excluded', () => {
    const tree = makeTree()
    const inclusion: Record<string, boolean> = {
      a1: false,
      a2: false,
      b1: false,
      b2: false,
    }
    const frags = buildFragments(tree, inclusion)
    expect(frags).toHaveLength(1)
    expect(frags[0].kind).toBe('bracket')
    expect(frags[0].nodeId).toBe('root')
  })

  it('recurses into mixed subtrees and brackets only excluded leaves', () => {
    const tree = makeTree()
    const inclusion: Record<string, boolean> = {
      a1: true,
      a2: false,
      b1: true,
      b2: true,
    }
    const frags = buildFragments(tree, inclusion)
    expect(frags.map((f) => `${f.kind}:${f.nodeId}`)).toEqual([
      'keep:a1',
      'bracket:a2',
      'keep:B',
    ])
  })

  it('merges adjacent excluded leaves into a single bracket', () => {
    const tree = makeTree()
    const inclusion: Record<string, boolean> = {
      a1: true,
      a2: false,
      b1: false, // adjacent in reading order to a2
      b2: true,
    }
    const frags = buildFragments(tree, inclusion)
    // a1 → keep, then a2+b1 merged into one bracket spanning 1000..3000, then b2 keep
    expect(frags).toHaveLength(3)
    expect(frags[0]).toMatchObject({ kind: 'keep', nodeId: 'a1' })
    expect(frags[1].kind).toBe('bracket')
    expect(frags[1].startOffset).toBe(1000)
    expect(frags[1].endOffset).toBe(3000)
    expect(frags[2]).toMatchObject({ kind: 'keep', nodeId: 'b2' })
  })

  it('length hint is determined by bracket bytes', () => {
    const tree = makeTree()
    const inclusion: Record<string, boolean> = {
      a1: false,
      a2: false,
      b1: false,
      b2: false,
    }
    const frags = buildFragments(tree, inclusion)
    expect(frags[0].kind).toBe('bracket')
    if (frags[0].kind !== 'bracket') return
    expect(frags[0].lengthHint).toBe(bytesToLengthHint(4000))
  })
})
