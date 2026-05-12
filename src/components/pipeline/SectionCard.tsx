import { motion, useReducedMotion } from 'motion/react'
import type { PhaseName, SectionPhaseStatus, PhaseStatusKind } from '@/state'
import type { MacroVerdict } from '@/pipeline/types'
import { PageFlip } from './PageFlip'

interface SectionCardProps {
  order: number
  title: string
  phaseStatus: SectionPhaseStatus
  decision?: MacroVerdict
  escalated?: boolean
  modelLabel?: string
  reducedMotion?: boolean
}

const VERDICT_TO_BADGE: Record<MacroVerdict, { className: string; symbol: string; label: string }> = {
  KEEP_FULL: { className: 'badge badge--keep', symbol: 'K', label: 'Keep full' },
  KEEP_PARTIAL: { className: 'badge badge--partial', symbol: 'P', label: 'Keep partial' },
  COMPRESS_TO_BRACKET: {
    className: 'badge badge--bracket',
    symbol: 'B',
    label: 'Compress to bracket',
  },
  DROP_TO_ONE_LINE: { className: 'badge badge--drop', symbol: 'D', label: 'Drop to one line' },
}

const STATUS_LABEL: Record<PhaseStatusKind, string> = {
  pending: 'pending',
  in_flight: 'in flight',
  done: 'done',
  error: 'error',
  skipped: 'skipped',
}

function pickPrimaryPhase(phaseStatus: SectionPhaseStatus): {
  phase: PhaseName
  status: PhaseStatusKind
} {
  const order: PhaseName[] = ['A', 'A5', 'B', 'B5', 'C1', 'C15', 'C2', 'D']
  for (const phase of order) {
    const s = phaseStatus[phase]?.status
    if (s === 'in_flight' || s === 'error') return { phase, status: s }
  }
  for (let i = order.length - 1; i >= 0; i -= 1) {
    const s = phaseStatus[order[i]]?.status
    if (s === 'done') return { phase: order[i], status: 'done' }
  }
  return { phase: 'A', status: 'pending' }
}

function StatusPill({ status }: { status: PhaseStatusKind }) {
  if (status === 'in_flight') {
    return (
      <span
        className="section-card__status section-card__status--inflight"
        aria-label="In flight"
      >
        <span className="section-card__spinner" aria-hidden="true" />
        <span>in flight</span>
      </span>
    )
  }
  if (status === 'done') {
    return (
      <span className="section-card__status section-card__status--done" aria-label="Done">
        <span aria-hidden="true">✓</span>
        <span>done</span>
      </span>
    )
  }
  if (status === 'error') {
    return (
      <span className="section-card__status section-card__status--error" aria-label="Error">
        <span aria-hidden="true">!</span>
        <span>error</span>
      </span>
    )
  }
  if (status === 'skipped') {
    return (
      <span className="section-card__status section-card__status--skipped" aria-label="Skipped">
        <span>skipped</span>
      </span>
    )
  }
  return (
    <span className="section-card__status section-card__status--pending" aria-label="Pending">
      <span>pending</span>
    </span>
  )
}

function DecisionBadge({ decision }: { decision: MacroVerdict }) {
  const meta = VERDICT_TO_BADGE[decision]
  return (
    <span className={meta.className} role="img" aria-label={meta.label}>
      <span>{meta.symbol}</span>
    </span>
  )
}

export function SectionCard({
  order,
  title,
  phaseStatus,
  decision,
  escalated,
  modelLabel,
}: SectionCardProps) {
  const reduced = useReducedMotion()
  const primary = pickPrimaryPhase(phaseStatus)
  const phaseBStatus = phaseStatus.B?.status ?? 'pending'
  const filled = phaseBStatus === 'done'

  return (
    <motion.article
      className="section-card parchment-card"
      aria-label={`Section ${order}: ${title}. ${STATUS_LABEL[primary.status]}.`}
      tabIndex={0}
      initial={reduced ? false : { opacity: 0.4 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4 }}
    >
      <header className="section-card__head">
        <div className="section-card__order">{order}</div>
        <StatusPill status={primary.status} />
      </header>

      <PageFlip filled={filled}>
        <div className="section-card__body">
          <h4 className="section-card__title">{title || 'Untitled section'}</h4>
          <p className="section-card__phase">
            <span className="section-card__phase-name">Phase {primary.phase}</span>
            <span className="section-card__phase-status"> · {STATUS_LABEL[primary.status]}</span>
          </p>
        </div>
      </PageFlip>

      <footer className="section-card__foot">
        {decision ? (
          <div className="section-card__decision">
            <DecisionBadge decision={decision} />
            {escalated ? (
              <span className="section-card__escalation" aria-label="Escalated by sanity check">
                ↑ KEEP_PARTIAL
              </span>
            ) : null}
          </div>
        ) : (
          <span className="section-card__decision-placeholder" aria-hidden="true">
            ·
          </span>
        )}
        {modelLabel ? (
          <span className="section-card__model" aria-label={`Routed to ${modelLabel}`}>
            {modelLabel}
          </span>
        ) : null}
      </footer>
    </motion.article>
  )
}
