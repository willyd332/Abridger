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

function formatNumber(n: number | undefined): string {
  if (n === undefined || !Number.isFinite(n)) return '—'
  return n.toLocaleString()
}

function reductionPct(original: number, abridged: number): string {
  if (!Number.isFinite(original) || original <= 0) return '—'
  if (!Number.isFinite(abridged)) return '—'
  const ratio = 1 - abridged / original
  return `${Math.max(0, Math.round(ratio * 100))}%`
}

function formatUsd(n: number): string {
  if (!Number.isFinite(n)) return '$—'
  return `$${n.toFixed(2)}`
}

interface StatProps {
  label: string
  value: string
  tone?: 'primary' | 'muted'
}

function Stat({ label, value, tone = 'primary' }: StatProps) {
  return (
    <div className={`stat stat--${tone}`}>
      <div className="stat__value">{value}</div>
      <div className="stat__label">{label}</div>
    </div>
  )
}

export function StatsRibbon({ stats }: StatsRibbonProps) {
  const reduction = reductionPct(stats.originalPages, stats.abridgedPages)
  return (
    <div className="stats-ribbon" role="group" aria-label="Run statistics">
      <Stat label="Original pages" value={formatNumber(stats.originalPages)} />
      <Stat label="Abridged pages" value={formatNumber(stats.abridgedPages)} />
      <Stat label="Reduction" value={reduction} />
      <Stat label="Tokens used" value={formatNumber(stats.totalTokens)} tone="muted" />
      <Stat label="Total cost" value={formatUsd(stats.totalCostUsd)} tone="muted" />
    </div>
  )
}
