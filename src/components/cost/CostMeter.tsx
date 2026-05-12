import { motion, useReducedMotion } from 'motion/react'
import {
  useAppStore,
  selectCostRemaining,
  selectCurrentPhase,
  selectProgress,
  type RunStatus,
} from '@/state'
import { Button } from '@/components/ui/Button'

interface CostMeterProps {
  onPause?: () => void
  onResume?: () => void
  onCancel?: () => void
  runStatus?: RunStatus
}

const PHASE_LABEL: Record<string, string> = {
  A: 'Phase A — Sectioning',
  A5: 'Phase A.5 — Canonical passages',
  B: 'Phase B — Summarizing sections',
  B5: 'Phase B.5 — Narrative spine',
  C1: 'Phase C1 — Macro decisions',
  C15: 'Phase C1.5 — Sanity escalation',
  C2: 'Phase C2 — Micro deletions',
  D: 'Phase D — Reconstruction',
}

function formatPhase(phase: string | null): string {
  if (!phase) return 'Preparing the press'
  return PHASE_LABEL[phase] ?? `Phase ${phase}`
}

function formatUsd(n: number): string {
  if (!Number.isFinite(n)) return '$—'
  return `$${n.toFixed(2)}`
}

export function CostMeter({ onPause, onResume, onCancel, runStatus }: CostMeterProps) {
  const reduced = useReducedMotion()
  const cost = useAppStore((state) => state.cost)
  const remaining = useAppStore(selectCostRemaining)
  const currentPhase = useAppStore(selectCurrentPhase)
  const progress = useAppStore(selectProgress)

  const used = cost.reservedUsd + cost.billedUsd
  const ratio = cost.ceilingUsd > 0 ? Math.min(1, used / cost.ceilingUsd) : 0
  const hardStop = cost.ceilingUsd > 0 && used >= cost.ceilingUsd
  const warnHigh = ratio >= 0.8 && !hardStop
  const warnMid = ratio >= 0.5 && !warnHigh && !hardStop

  let tone: 'normal' | 'mid' | 'high' | 'stop' = 'normal'
  if (hardStop) tone = 'stop'
  else if (warnHigh) tone = 'high'
  else if (warnMid) tone = 'mid'

  const phaseLabel = formatPhase(currentPhase)
  const progressLabel = progress.total > 0 ? `${progress.done}/${progress.total}` : '—'
  const isPaused = runStatus === 'paused'

  return (
    <div
      className={`cost-meter cost-meter--${tone}`}
      role="region"
      aria-label="Run progress and cost ribbon"
    >
      <div className="cost-meter__left">
        <div className="cost-meter__phase">{phaseLabel}</div>
        <div className="cost-meter__progress">
          <span className="cost-meter__progress-text" aria-live="polite">
            {progressLabel} sections
          </span>
          <div
            className="cost-meter__bar"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={progress.total || 1}
            aria-valuenow={progress.done}
            aria-label="Sections completed"
          >
            <motion.div
              className="cost-meter__bar-fill"
              initial={false}
              animate={{ width: `${progress.ratio * 100}%` }}
              transition={
                reduced ? { duration: 0 } : { duration: 0.45, ease: [0.22, 0.61, 0.36, 1] }
              }
            />
          </div>
        </div>
      </div>

      <div className="cost-meter__middle">
        <div className="cost-meter__cost-line">
          <span className="cost-meter__cost-used">{formatUsd(used)}</span>
          <span className="cost-meter__cost-sep">/</span>
          <span className="cost-meter__cost-ceiling">{formatUsd(cost.ceilingUsd)} ceiling</span>
        </div>
        <div className="cost-meter__cost-remaining" aria-live="polite">
          {hardStop
            ? 'Cost ceiling reached — run paused.'
            : `Remaining: ${formatUsd(remaining)}`}
        </div>
      </div>

      <div className="cost-meter__right" role="group" aria-label="Run controls">
        {hardStop || isPaused ? (
          <Button variant="ghost" onClick={onResume} aria-label="Resume run">
            Resume
          </Button>
        ) : (
          <Button variant="ghost" onClick={onPause} aria-label="Pause run">
            Pause
          </Button>
        )}
        <Button variant="ghost" onClick={onCancel} aria-label="Cancel run">
          Stop
        </Button>
      </div>
    </div>
  )
}
