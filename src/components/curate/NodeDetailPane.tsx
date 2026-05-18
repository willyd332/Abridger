import { useCallback, useMemo, useState } from 'react'

import { Button } from '@/components/ui/Button'
import { buildTitleChain } from '@/pipeline/ontology/inclusion'
import type {
  NodeDependencies,
  OntologyTree,
} from '@/pipeline/ontology/types'

interface Props {
  tree: OntologyTree
  bookText: string | null
  selectedNodeId: string | null
  dependenciesCache: Record<string, NodeDependencies>
  onSearchDependencies: (nodeId: string) => Promise<void> | void
  onNavigateToNode: (nodeId: string) => void
  searching: boolean
}

export function NodeDetailPane({
  tree,
  bookText,
  selectedNodeId,
  dependenciesCache,
  onSearchDependencies,
  onNavigateToNode,
  searching,
}: Props) {
  const [rawOpen, setRawOpen] = useState(false)

  const node = selectedNodeId ? tree.nodes[selectedNodeId] : null

  const chain = useMemo(
    () => (node ? buildTitleChain(tree, node.id).slice(0, -1).join(' › ') : ''),
    [tree, node],
  )

  const handleSearch = useCallback(() => {
    if (!node) return
    void onSearchDependencies(node.id)
  }, [node, onSearchDependencies])

  if (!node) {
    return (
      <aside className="curate__detail">
        <p className="detail__empty">
          Select a node in the tree to see its summary and run a dependency
          search.
        </p>
      </aside>
    )
  }

  const deps = dependenciesCache[node.id] ?? null
  const summary = node.summary?.text
  const pageRange =
    node.startPage && node.endPage
      ? node.startPage === node.endPage
        ? `p. ${node.startPage}`
        : `pp. ${node.startPage}–${node.endPage}`
      : 'pages unknown'
  const byteSize = node.endOffset - node.startOffset

  return (
    <aside className="curate__detail" aria-live="polite">
      {chain ? <div className="detail__chain">{chain}</div> : null}
      <h3 className="detail__title">{node.title}</h3>
      <div className="detail__meta">
        {pageRange} · {byteSize.toLocaleString()} chars ·{' '}
        {node.isLeaf ? 'leaf' : `${node.childIds.length} children`}
      </div>
      {summary ? (
        <div className="detail__summary">{summary}</div>
      ) : (
        <p className="detail__empty">No summary available for this node yet.</p>
      )}

      <div className="detail__deps">
        <h4 className="detail__deps-title">Downstream dependencies</h4>
        {deps ? (
          deps.downstream.length === 0 ? (
            <p className="detail__empty">
              No load-bearing downstream dependencies were found.
            </p>
          ) : (
            <ul className="detail__deps-list">
              {deps.downstream.map((d) => {
                const target = tree.nodes[d.nodeId]
                if (!target) return null
                return (
                  <li key={d.nodeId} className="detail__dep-item">
                    <button
                      type="button"
                      className="detail__dep-link"
                      onClick={() => onNavigateToNode(d.nodeId)}
                    >
                      {buildTitleChain(tree, d.nodeId).join(' › ')}
                    </button>
                    <div className="detail__dep-rationale">{d.rationale}</div>
                  </li>
                )
              })}
            </ul>
          )
        ) : (
          <Button
            onClick={handleSearch}
            disabled={searching}
            aria-label="Search downstream dependencies"
          >
            {searching ? 'Searching…' : 'Search dependencies'}
          </Button>
        )}
      </div>

      {bookText ? (
        <details
          className="detail__raw-text"
          open={rawOpen}
          onToggle={(e) => setRawOpen((e.target as HTMLDetailsElement).open)}
        >
          <summary className="detail__raw-summary">Show passage text</summary>
          <pre className="detail__raw-body">
            {bookText.slice(node.startOffset, node.endOffset)}
          </pre>
        </details>
      ) : null}
    </aside>
  )
}
