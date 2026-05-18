import { useCallback } from 'react'

import type { OntologyTree as OntologyTreeData } from '@/pipeline/ontology/types'

import { OntologyNodeRow } from './OntologyNodeRow'

interface Props {
  tree: OntologyTreeData
  inclusion: Record<string, boolean>
  expanded: Record<string, boolean>
  selectedNodeId: string | null
  onSelect: (nodeId: string) => void
  onToggleExpanded: (nodeId: string) => void
  onToggleInclusion: (nodeId: string) => void
}

export function OntologyTree({
  tree,
  inclusion,
  expanded,
  selectedNodeId,
  onSelect,
  onToggleExpanded,
  onToggleInclusion,
}: Props) {
  const renderSubtree = useCallback(
    (nodeId: string): React.ReactNode => {
      const node = tree.nodes[nodeId]
      if (!node) return null
      const isExpanded = expanded[nodeId] !== false // default expanded
      const showChildren = !node.isLeaf && node.childIds.length > 0 && isExpanded
      return (
        <li key={nodeId} role="none">
          <OntologyNodeRow
            tree={tree}
            node={node}
            inclusion={inclusion}
            expanded={isExpanded}
            selected={selectedNodeId === nodeId}
            onSelect={onSelect}
            onToggleExpanded={onToggleExpanded}
            onToggleInclusion={onToggleInclusion}
          />
          {showChildren ? (
            <ul role="group">{node.childIds.map(renderSubtree)}</ul>
          ) : null}
        </li>
      )
    },
    [tree, inclusion, expanded, selectedNodeId, onSelect, onToggleExpanded, onToggleInclusion],
  )

  return (
    <nav className="curate__tree" aria-label="Book ontology">
      <ul role="tree">{renderSubtree(tree.rootId)}</ul>
    </nav>
  )
}
