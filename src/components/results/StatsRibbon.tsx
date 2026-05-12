export interface RunStats {
  originalPages: number
  abridgedPages: number
  totalTokens?: number
  totalCostUsd: number
  sectionsKept?: number
  sectionsDropped?: number
}

interface StatsRibbonProps {
  stats: RunStats
}

function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return '—'
  return n.toLocaleString()
}

function reductionPct(original: number, abridged: number): string {
  if (!Number.isFinite(original) || original <= 0) return '—'
  const ratio = 1 - abridged / original
  return `${Math.max(0, Math.round(ratio * 100))}%`
}

function formatUsd(n: number): string {
  if (!Number.isFinite(n)) return '$—'
  return `$${n.toFixed(2)}`
}

export function StatsRibbon({ stats }: StatsRibbonProps) {
  const reduction = reductionPct(stats.originalPages, stats.abridgedPages)
  return (
    <div className="stats-ribbon" role="group" aria-label="Run statistics">
      <div className="stats-ribbon__cell">
        <div className="stats-ribbon__numeral drop-cap">
          {formatNumber(stats.originalPages)}
        </div>
        <div className="stats-ribbon__label">original pages</div>
      </div>
      <div className="stats-ribbon__cell">
        <div className="stats-ribbon__numeral drop-cap">
          {formatNumber(stats.abridgedPages)}
        </div>
        <div className="stats-ribbon__label">abridged pages</div>
      </div>
      <div className="stats-ribbon__cell">
        <div className="stats-ribbon__numeral drop-cap">{reduction}</div>
        <div className="stats-ribbon__label">reduction</div>
      </div>
      <div className="stats-ribbon__cell stats-ribbon__cell--secondary">
        <div className="stats-ribbon__secondary">
          {stats.totalTokens !== undefined ? formatNumber(stats.totalTokens) : '—'}
        </div>
        <div className="stats-ribbon__label">tokens</div>
      </div>
      <div className="stats-ribbon__cell stats-ribbon__cell--secondary">
        <div className="stats-ribbon__secondary">{formatUsd(stats.totalCostUsd)}</div>
        <div className="stats-ribbon__label">total cost</div>
      </div>
    </div>
  )
}
