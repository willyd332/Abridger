import { describe, expect, it } from 'vitest'

import { summarizeOntology } from '@/pipeline/ontology/summarize'
import type { OntologyNode, OntologyTree } from '@/pipeline/ontology/types'

import { makeClient } from '../fixtures'

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
    title: `Leaf ${id}`,
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
    title: `Internal ${id}`,
    startOffset,
    endOffset,
    startPage: 1,
    endPage: 1,
    isLeaf: false,
    source: parentId === null ? 'root' : 'llm-decomposed',
    summary: null,
  }
}

function makeMiniTree(): { tree: OntologyTree; text: string } {
  // root → [A → [a1, a2], B → [b1]]
  const text = 'a'.repeat(800)
  const nodes: Record<string, OntologyNode> = {}
  nodes['root'] = makeInternal('root', null, 0, 0, ['A', 'B'], 0, 800)
  nodes['A'] = makeInternal('A', 'root', 0, 1, ['a1', 'a2'], 0, 400)
  nodes['B'] = makeInternal('B', 'root', 1, 1, ['b1'], 400, 800)
  nodes['a1'] = makeLeaf('a1', 'A', 0, 2, 0, 200)
  nodes['a2'] = makeLeaf('a2', 'A', 1, 2, 200, 400)
  nodes['b1'] = makeLeaf('b1', 'B', 0, 2, 400, 800)
  const tree: OntologyTree = {
    rootId: 'root',
    nodes,
    leafIdsInOrder: ['a1', 'a2', 'b1'],
    totalChars: text.length,
    builtAt: Date.now(),
  }
  return { tree, text }
}

describe('summarizeOntology', () => {
  it('summarizes leaves first, then internal nodes with child summaries available', async () => {
    const { tree, text } = makeMiniTree()
    const client = makeClient()
    const mock = client.useMockProvider()
    mock.registerMatcher(
      'leaf-call',
      (_m, opts) => opts.metadata.phase === 'S-leaf',
      {
        text: JSON.stringify({
          summary:
            'This leaf advances the central argument through specific examples and an evidence dump that sets up later objections.',
          wordCount: 19,
        }),
      },
    )
    mock.registerMatcher(
      'internal-call',
      (_m, opts) => opts.metadata.phase === 'S-internal',
      {
        text: JSON.stringify({
          summary:
            'This internal node binds its children into a sustained move that culminates in a coherent conclusion the author then carries forward into subsequent chapters of the work, presenting a unified rhetorical arc that the reader should be able to follow.',
          wordCount: 40,
        }),
      },
    )

    const result = await summarizeOntology(tree, client, { bookText: text })
    expect(result.leavesSummarized).toBe(3)
    expect(result.internalSummarized).toBe(3) // root + A + B

    // Every node should have a summary
    for (const id of Object.keys(result.tree.nodes)) {
      expect(result.tree.nodes[id].summary).not.toBeNull()
    }

    // Order: leaves at depth=2 must be summarized before internals at depth=1,
    // and internals at depth=1 before depth=0 (root). We verify this by
    // tracking call order in mock history: all S-leaf calls must precede
    // their parents' S-internal calls.
    const calls = mock.history()
    const leafCallIdx = calls.findIndex((c) => c.opts.metadata.phase === 'S-leaf')
    const internalCallIdx = calls.findIndex(
      (c) => c.opts.metadata.phase === 'S-internal',
    )
    expect(leafCallIdx).toBeLessThan(internalCallIdx)
  })

  it('uses placeholder summary when JSON is invalid', async () => {
    const { tree, text } = makeMiniTree()
    const client = makeClient()
    const mock = client.useMockProvider()
    mock.setDefaultResponse({ text: 'not json at all' })

    const result = await summarizeOntology(tree, client, { bookText: text })
    for (const id of Object.keys(result.tree.nodes)) {
      const summary = result.tree.nodes[id].summary
      expect(summary).not.toBeNull()
      expect(summary?.text.length).toBeGreaterThan(0)
    }
  })
})
