import type { InclusionState, OntologyTree } from './types'

export function getInclusionState(
  tree: OntologyTree,
  nodeId: string,
  inclusion: Record<string, boolean>,
): InclusionState {
  const node = tree.nodes[nodeId]
  if (!node) return 'none'
  if (node.isLeaf) {
    return inclusion[node.id] === false ? 'none' : 'all'
  }
  // Internal node with no children (e.g. broken tree) is treated as excluded
  // so that the export walker brackets it rather than dumping raw text.
  if (node.childIds.length === 0) return 'none'

  let seenIncluded = false
  let seenExcluded = false
  const stack = [...node.childIds]
  while (stack.length) {
    const childId = stack.pop()!
    const child = tree.nodes[childId]
    if (!child) continue
    if (child.isLeaf) {
      if (inclusion[child.id] === false) seenExcluded = true
      else seenIncluded = true
    } else {
      stack.push(...child.childIds)
    }
    if (seenIncluded && seenExcluded) return 'mixed'
  }
  if (seenIncluded && !seenExcluded) return 'all'
  if (!seenIncluded && seenExcluded) return 'none'
  // No leaves at all under this internal node — exclude defensively.
  return 'none'
}

export function collectLeafIdsInOrder(
  tree: OntologyTree,
  nodeId: string,
): string[] {
  const node = tree.nodes[nodeId]
  if (!node) return []
  if (node.isLeaf) return [node.id]
  const out: string[] = []
  for (const childId of node.childIds) {
    out.push(...collectLeafIdsInOrder(tree, childId))
  }
  return out
}

export function buildTitleChain(
  tree: OntologyTree,
  nodeId: string,
): string[] {
  const chain: string[] = []
  let current: string | null = nodeId
  while (current) {
    const node: import('./types').OntologyNode | undefined = tree.nodes[current]
    if (!node) break
    chain.unshift(node.title)
    current = node.parentId
  }
  return chain
}

export function nodeByteSize(
  tree: OntologyTree,
  nodeId: string,
): number {
  const node = tree.nodes[nodeId]
  if (!node) return 0
  return node.endOffset - node.startOffset
}

export function countLeaves(tree: OntologyTree, nodeId: string): number {
  const node = tree.nodes[nodeId]
  if (!node) return 0
  if (node.isLeaf) return 1
  let total = 0
  for (const childId of node.childIds) {
    total += countLeaves(tree, childId)
  }
  return total
}
