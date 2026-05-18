import { useCallback, useEffect, useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'

import { Button } from '@/components/ui/Button'
import { countLeaves, getInclusionState } from '@/pipeline/ontology/inclusion'
import type {
  NodeDependencies,
  OntologyTree,
} from '@/pipeline/ontology/types'
import { getAppStore, useAppStore } from '@/state'

import './curate.css'
import { NodeDetailPane } from './NodeDetailPane'
import { OntologyTree as OntologyTreeView } from './OntologyTree'

interface Props {
  bookText: string | null
  onExport: () => void
  onOpenSuggest: () => void
  onSearchDependencies: (nodeId: string) => Promise<void> | void
  searchingDependencies: boolean
}

export function CurateScreen({
  bookText,
  onExport,
  onOpenSuggest,
  onSearchDependencies,
  searchingDependencies,
}: Props) {
  const tree = useAppStore((s) => s.curate.tree)
  const inclusion = useAppStore(useShallow((s) => s.curate.inclusion))
  const expanded = useAppStore(useShallow((s) => s.curate.expanded))
  const selectedNodeId = useAppStore((s) => s.curate.selectedNodeId)
  const dependenciesCache = useAppStore(
    useShallow((s) => s.curate.dependenciesCache),
  )
  const preSuggestSnapshot = useAppStore((s) => s.curate.preSuggestSnapshot)

  const store = getAppStore().getState()

  const handleSelect = useCallback(
    (id: string) => store.setSelectedNode(id),
    [store],
  )
  const handleToggleExpanded = useCallback(
    (id: string) => {
      const current = getAppStore().getState().curate.expanded[id]
      // default is expanded; if explicitly false, set to true; otherwise set to false
      store.setExpanded(id, current === false ? true : false)
    },
    [store],
  )
  const handleToggleInclusion = useCallback(
    (id: string) => {
      void store.toggleNodeInclusion(id)
    },
    [store],
  )

  // Auto-expand top two levels on first load
  useEffect(() => {
    if (!tree) return
    if (Object.keys(expanded).length > 0) return
    const patch: Record<string, boolean> = {}
    for (const id of Object.keys(tree.nodes)) {
      const node = tree.nodes[id]
      patch[id] = node.depth <= 1
    }
    store.setManyExpanded(patch)
    if (!selectedNodeId) store.setSelectedNode(tree.rootId)
  }, [tree, expanded, selectedNodeId, store])

  if (!tree) {
    return (
      <section className="parchment-card" aria-busy>
        <p className="detail__empty">Building the book's ontology…</p>
      </section>
    )
  }

  return (
    <CurateContent
      tree={tree}
      inclusion={inclusion}
      expanded={expanded}
      selectedNodeId={selectedNodeId}
      bookText={bookText}
      onSelect={handleSelect}
      onToggleExpanded={handleToggleExpanded}
      onToggleInclusion={handleToggleInclusion}
      onExport={onExport}
      onOpenSuggest={onOpenSuggest}
      onSearchDependencies={onSearchDependencies}
      searchingDependencies={searchingDependencies}
      dependenciesCache={dependenciesCache}
      canRevert={preSuggestSnapshot !== null}
      onRevert={() => void store.revertSuggest()}
    />
  )
}

interface ContentProps {
  tree: OntologyTree
  inclusion: Record<string, boolean>
  expanded: Record<string, boolean>
  selectedNodeId: string | null
  bookText: string | null
  onSelect: (id: string) => void
  onToggleExpanded: (id: string) => void
  onToggleInclusion: (id: string) => void
  onExport: () => void
  onOpenSuggest: () => void
  onSearchDependencies: (nodeId: string) => Promise<void> | void
  searchingDependencies: boolean
  dependenciesCache: Record<string, NodeDependencies>
  canRevert: boolean
  onRevert: () => void
}

function CurateContent({
  tree,
  inclusion,
  expanded,
  selectedNodeId,
  bookText,
  onSelect,
  onToggleExpanded,
  onToggleInclusion,
  onExport,
  onOpenSuggest,
  onSearchDependencies,
  searchingDependencies,
  dependenciesCache,
  canRevert,
  onRevert,
}: ContentProps) {
  const stats = useMemo(() => {
    const totalLeaves = countLeaves(tree, tree.rootId)
    const includedLeaves = tree.leafIdsInOrder.filter(
      (id) => inclusion[id] !== false,
    ).length
    const rootState = getInclusionState(tree, tree.rootId, inclusion)
    const pageCountFor = (id: string): number => {
      const node = tree.nodes[id]
      if (!node) return 0
      if (node.startPage === null || node.endPage === null) return 0
      return node.endPage - node.startPage + 1
    }
    const totalPages = tree.leafIdsInOrder.reduce(
      (sum, id) => sum + pageCountFor(id),
      0,
    )
    const includedPages = tree.leafIdsInOrder.reduce(
      (sum, id) => (inclusion[id] !== false ? sum + pageCountFor(id) : sum),
      0,
    )
    return {
      totalLeaves,
      includedLeaves,
      rootState,
      totalPages,
      includedPages,
    }
  }, [tree, inclusion])

  return (
    <div className="curate">
      <header className="curate__toolbar">
        <div className="curate__toolbar-left">
          <h2 className="curate__toolbar-title">Curate your abridgment</h2>
          <p className="curate__toolbar-hint">
            {stats.includedLeaves.toLocaleString()} of{' '}
            {stats.totalLeaves.toLocaleString()} leaves
            {stats.totalPages > 0 ? (
              <>
                {' '}
                · {Math.round(stats.includedPages).toLocaleString()} of{' '}
                {Math.round(stats.totalPages).toLocaleString()} pages
              </>
            ) : null}{' '}
            · click a node to see its summary
          </p>
        </div>
        <div className="curate__toolbar-actions">
          {canRevert ? (
            <Button variant="ghost" onClick={onRevert}>
              Revert suggestion
            </Button>
          ) : null}
          <Button variant="ghost" onClick={onOpenSuggest}>
            Suggest abridgement…
          </Button>
          <Button onClick={onExport} disabled={stats.includedLeaves === 0}>
            Export
          </Button>
        </div>
      </header>
      <OntologyTreeView
        tree={tree}
        inclusion={inclusion}
        expanded={expanded}
        selectedNodeId={selectedNodeId}
        onSelect={onSelect}
        onToggleExpanded={onToggleExpanded}
        onToggleInclusion={onToggleInclusion}
      />
      <NodeDetailPane
        tree={tree}
        bookText={bookText}
        selectedNodeId={selectedNodeId}
        dependenciesCache={dependenciesCache}
        onSearchDependencies={onSearchDependencies}
        onNavigateToNode={onSelect}
        searching={searchingDependencies}
      />
    </div>
  )
}
