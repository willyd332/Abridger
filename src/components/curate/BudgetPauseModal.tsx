import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/Button'

interface Props {
  open: boolean
  billedUsd: number
  ceilingUsd: number
  pendingCount: number
  onRaise: (newCeilingUsd: number) => void
  onStop: () => void
}

function formatUsd(n: number): string {
  return `$${n.toFixed(2)}`
}

// Default suggestion: double the current ceiling, rounded to the nearest $5.
function suggestNextCeiling(current: number): number {
  const doubled = current * 2
  return Math.max(current + 5, Math.ceil(doubled / 5) * 5)
}

export function BudgetPauseModal({
  open,
  billedUsd,
  ceilingUsd,
  pendingCount,
  onRaise,
  onStop,
}: Props) {
  const [newCeilingText, setNewCeilingText] = useState('')

  useEffect(() => {
    if (open) {
      setNewCeilingText(String(suggestNextCeiling(ceilingUsd)))
    }
  }, [open, ceilingUsd])

  if (!open) return null

  const newCeiling = Number.parseFloat(newCeilingText)
  const newCeilingValid =
    Number.isFinite(newCeiling) && newCeiling > ceilingUsd

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="budget-pause-title"
    >
      <div className="modal">
        <h3 id="budget-pause-title" className="modal__title">
          Spending ceiling reached
        </h3>
        <p className="modal__hint">
          The pipeline is paused. {pendingCount} LLM call
          {pendingCount === 1 ? ' is' : 's are'} parked, waiting for room in
          the budget. Raise the ceiling to keep going, or stop here and keep
          the partial tree.
        </p>
        <div className="budget-pause__numbers">
          <div className="budget-pause__row">
            <span className="budget-pause__label">Spent so far</span>
            <span className="budget-pause__value">{formatUsd(billedUsd)}</span>
          </div>
          <div className="budget-pause__row">
            <span className="budget-pause__label">Current ceiling</span>
            <span className="budget-pause__value">{formatUsd(ceilingUsd)}</span>
          </div>
        </div>
        <label className="budget-pause__input-label">
          <span>New ceiling (USD)</span>
          <input
            type="number"
            min={ceilingUsd}
            step="1"
            value={newCeilingText}
            onChange={(e) => setNewCeilingText(e.target.value)}
            className="parchment-input"
            aria-label="New spending ceiling in US dollars"
          />
        </label>
        <p className="budget-pause__warning">
          Sunk: the {formatUsd(billedUsd)} already spent is non-refundable
          regardless of what you pick here. Stopping leaves a partial tree
          (excluded nodes show placeholder summaries); raising keeps building
          and only commits more cost if the new ceiling allows.
        </p>
        <div className="modal__actions">
          <Button variant="ghost" onClick={onStop}>
            Stop here
          </Button>
          <Button
            onClick={() => onRaise(newCeiling)}
            disabled={!newCeilingValid}
          >
            Raise to {newCeilingValid ? formatUsd(newCeiling) : '—'} and continue
          </Button>
        </div>
      </div>
    </div>
  )
}
