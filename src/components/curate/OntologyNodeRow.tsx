import { memo, useCallback } from 'react'

import { getInclusionState } from '@/pipeline/ontology/inclusion'
import type { OntologyNode, OntologyTree } from '@/pipeline/ontology/types'

interface Props {
  tree: OntologyTree
  node: OntologyNode
  inclusion: Record<string, boolean>
  expanded: boolean
  selected: boolean
  onSelect: (nodeId: string) => void
  onToggleExpanded: (nodeId: string) => void
  onToggleInclusion: (nodeId: string) => void
}

export const OntologyNodeRow = memo(function OntologyNodeRow({
  tree,
  node,
  inclusion,
  expanded,
  selected,
  onSelect,
  onToggleExpanded,
  onToggleInclusion,
}: Props) {
  const inclusionState = getInclusionState(tree, node.id, inclusion)
  const hasChildren = !node.isLeaf && node.childIds.length > 0

  const handleSelect = useCallback(() => {
    onSelect(node.id)
  }, [node.id, onSelect])

  const handleChevron = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      if (hasChildren) onToggleExpanded(node.id)
    },
    [hasChildren, node.id, onToggleExpanded],
  )

  const handleCheckbox = useCallback(
    (e: React.MouseEvent | React.ChangeEvent) => {
      e.stopPropagation()
      onToggleInclusion(node.id)
    },
    [node.id, onToggleInclusion],
  )

  const indent = node.depth * 1.2
  const excluded = inclusionState === 'none'
  const rowClass = ['tree-row']
  if (selected) rowClass.push('tree-row--selected')
  if (excluded) rowClass.push('tree-row--excluded')

  const pageRange =
    node.startPage && node.endPage
      ? node.startPage === node.endPage
        ? `p. ${node.startPage}`
        : `pp. ${node.startPage}–${node.endPage}`
      : null

  return (
    <div
      className={rowClass.join(' ')}
      onClick={handleSelect}
      role="treeitem"
      aria-selected={selected}
      aria-expanded={hasChildren ? expanded : undefined}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          handleSelect()
        } else if (e.key === 'ArrowRight' && hasChildren && !expanded) {
          onToggleExpanded(node.id)
        } else if (e.key === 'ArrowLeft' && hasChildren && expanded) {
          onToggleExpanded(node.id)
        }
      }}
    >
      <span className="tree-row__indent" style={{ width: `${indent}rem` }} />
      <span
        className={
          hasChildren
            ? 'tree-row__chevron'
            : 'tree-row__chevron tree-row__chevron--placeholder'
        }
        onClick={handleChevron}
        aria-hidden
      >
        {hasChildren ? (expanded ? '▾' : '▸') : '•'}
      </span>
      <input
        type="checkbox"
        className="tree-row__checkbox"
        ref={(el) => {
          if (el) el.indeterminate = inclusionState === 'mixed'
        }}
        checked={inclusionState === 'all'}
        onChange={handleCheckbox}
        onClick={handleCheckbox}
        aria-label={`Include ${node.title} in abridgment`}
      />
      <span className="tree-row__label">
        <span className="tree-row__title">
          {node.title}
          {node.isLeaf ? <span className="tree-row__leaf-badge">leaf</span> : null}
        </span>
        {pageRange ? (
          <span className="tree-row__meta">{pageRange}</span>
        ) : null}
      </span>
    </div>
  )
})
