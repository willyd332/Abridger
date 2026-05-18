import type { BracketLengthHint, NarrativeSpine } from '../types'

export type OntologySource = 'root' | 'toc' | 'llm-decomposed' | 'forced-leaf'

export type NodeSummary = {
  text: string
  wordCount: number
  generatedAt: number
}

export type NodeDependency = {
  nodeId: string
  rationale: string
}

export type NodeDependencies = {
  focalNodeId: string
  downstream: NodeDependency[]
  computedAt: number
  model: string
}

export type OntologyNode = {
  id: string
  parentId: string | null
  childIds: string[]
  order: number
  depth: number

  title: string
  startOffset: number
  endOffset: number
  startPage: number | null
  endPage: number | null

  isLeaf: boolean
  source: OntologySource
  summary: NodeSummary | null
}

export type OntologyTree = {
  rootId: string
  nodes: Record<string, OntologyNode>
  leafIdsInOrder: string[]
  totalChars: number
  builtAt: number
}

export type OntologyContext = {
  spine: NarrativeSpine | null
  originalLengthChars: number
}

export type Fragment =
  | {
      kind: 'keep'
      nodeId: string
      startOffset: number
      endOffset: number
    }
  | {
      kind: 'bracket'
      nodeId: string
      startOffset: number
      endOffset: number
      lengthHint: BracketLengthHint
      bytes: number
    }

export type InclusionState = 'all' | 'none' | 'mixed'

// Leaf granularity is measured in PAGES. A leaf should be small enough that
// a reader can absorb it in one sitting and that the LLM can summarize it
// cheaply — target is 3–5 pages of body text. The budget is the *max*
// pageCount that still counts as a leaf (≤5 pages → leaf, >5 pages → recurse).
export const LEAF_PAGE_BUDGET = 5
// Hard floor for a child produced by Phase O. Children smaller than this get
// merged into a sibling before they enter the tree, so a 1- or 2-page
// "subtopic" never appears as a leaf in its own right.
export const MIN_CHILD_PAGES = 3
export const MIN_CHILD_BYTES = 7_500
export const MAX_CHILDREN_PER_NODE = 8
export const MAX_TREE_DEPTH = 6

// Retained for places that still reason in characters (kept conservative
// to avoid Phase S context overflow on dense single-page nodes).
export const LEAF_BYTE_BUDGET = 20_000

export const BRACKET_LENGTH_THRESHOLDS: Array<{
  maxBytes: number
  hint: BracketLengthHint
}> = [
  { maxBytes: 1_500, hint: 'one-line' },
  { maxBytes: 7_500, hint: 'short' },
  { maxBytes: 30_000, hint: 'medium' },
  { maxBytes: Number.POSITIVE_INFINITY, hint: 'long' },
]

export function bytesToLengthHint(bytes: number): BracketLengthHint {
  for (const tier of BRACKET_LENGTH_THRESHOLDS) {
    if (bytes <= tier.maxBytes) return tier.hint
  }
  return 'long'
}
