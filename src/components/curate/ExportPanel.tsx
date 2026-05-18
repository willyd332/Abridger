import { useCallback, useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'

import { Button } from '@/components/ui/Button'

export type ExportFormat = 'pdf' | 'epub'

export type BracketProgress = {
  done: number
  total: number
}

interface Props {
  open: boolean
  onClose: () => void
  onExport: (format: ExportFormat) => Promise<void> | void
  defaultFormat: ExportFormat
  exporting: boolean
  bracketProgress: BracketProgress | null
}

export function ExportPanel({
  open,
  onClose,
  onExport,
  defaultFormat,
  exporting,
  bracketProgress,
}: Props) {
  const [format, setFormat] = useState<ExportFormat>(defaultFormat)

  const handleExport = useCallback(async () => {
    await onExport(format)
  }, [format, onExport])

  if (!open) return null

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal">
        <h3 className="modal__title">Export abridgment</h3>
        {exporting ? (
          <ExportLoader progress={bracketProgress} />
        ) : (
          <>
            <p className="modal__hint">
              Excluded subtrees will be replaced by bracketed editorial summaries.
              Bracket length scales with the size of what was removed.
            </p>
            <fieldset
              style={{ border: 'none', padding: 0, margin: '0 0 0.75rem' }}
            >
              <legend
                style={{
                  fontSize: '0.8rem',
                  letterSpacing: '0.05em',
                  textTransform: 'uppercase',
                  color: 'var(--ink-fg-soft)',
                  marginBottom: '0.35rem',
                }}
              >
                Format
              </legend>
              {(['pdf', 'epub'] as const).map((f) => (
                <label
                  key={f}
                  style={{
                    display: 'block',
                    fontSize: '0.95rem',
                    marginBottom: '0.25rem',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="radio"
                    name="export-format"
                    value={f}
                    checked={format === f}
                    onChange={() => setFormat(f)}
                    style={{ marginRight: '0.5rem' }}
                  />
                  {f.toUpperCase()}
                </label>
              ))}
            </fieldset>
            <div className="modal__actions">
              <Button variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button onClick={handleExport}>Generate</Button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/**
 * ExportLoader: two-stage status display.
 *  - Stage A — "Generating editorial brackets — N of M…" while brackets are
 *    still being written. The gilt arc fills from 0 → N/M.
 *  - Stage B — "Editing the original file…" once all brackets are done and
 *    the original file is being rewritten (pdf-lib / JSZip).
 *
 * Reduced-motion users get a static line.
 */
function ExportLoader({
  progress,
}: {
  progress: BracketProgress | null
}): JSX.Element {
  const reduced = useReducedMotion()

  const stage: 'brackets' | 'rewriting' =
    progress && progress.done < progress.total ? 'brackets' : 'rewriting'
  const stageLabel =
    stage === 'brackets' && progress
      ? `Generating editorial brackets — ${progress.done} of ${progress.total}…`
      : 'Editing the original file…'

  if (reduced) {
    return (
      <div
        className="export-loader export-loader--reduced"
        role="status"
        aria-live="polite"
      >
        {stageLabel}
      </div>
    )
  }

  // Determinate fill while brackets are running; switch to a slow indeterminate
  // sweep once we move into the rewriting stage.
  const ratio =
    stage === 'brackets' && progress && progress.total > 0
      ? Math.min(1, progress.done / progress.total)
      : 1

  return (
    <div className="export-loader" role="status" aria-live="polite">
      <ExportArc ratio={ratio} indeterminate={stage === 'rewriting'} />
      <p className="export-loader__status">{stageLabel}</p>
      {stage === 'brackets' && progress ? (
        <p className="export-loader__sub">
          The Book Abridger is composing a bracketed summary for each excluded passage.
        </p>
      ) : (
        <p className="export-loader__sub">
          Stitching kept pages and editorial brackets into the final file.
        </p>
      )}
    </div>
  )
}

/**
 * A gilt arc on a faint ring. When `indeterminate` is true the whole svg
 * rotates slowly and a leading pip pulses; when false the arc length reflects
 * `ratio` (0–1) and the numeric overlay shows that fraction.
 */
function ExportArc({
  ratio,
  indeterminate,
}: {
  ratio: number
  indeterminate: boolean
}): JSX.Element {
  const radius = 28
  const circumference = 2 * Math.PI * radius
  const filledArc = Math.max(circumference * 0.02, circumference * ratio)

  return (
    <div className="export-loader__arc" aria-hidden="true">
      <motion.svg
        className="export-loader__arc-svg"
        viewBox="0 0 72 72"
        animate={indeterminate ? { rotate: 360 } : { rotate: 0 }}
        transition={
          indeterminate
            ? { duration: 3.2, ease: 'linear', repeat: Infinity }
            : { duration: 0 }
        }
      >
        <circle
          className="export-loader__arc-track"
          cx="36"
          cy="36"
          r={radius}
        />
        <motion.circle
          className="export-loader__arc-fill"
          cx="36"
          cy="36"
          r={radius}
          transform="rotate(-90 36 36)"
          strokeDasharray={`${filledArc} ${circumference}`}
          animate={{
            opacity: indeterminate ? [0.55, 1, 0.55] : 1,
          }}
          transition={
            indeterminate
              ? { duration: 2.2, ease: 'easeInOut', repeat: Infinity }
              : { duration: 0.4, ease: 'easeOut' }
          }
        />
        {indeterminate ? (
          <motion.circle
            className="export-loader__arc-pip"
            cx="36"
            cy="8"
            r={2.4}
            style={{ originX: '36px', originY: '36px' }}
            animate={{ scale: [0.85, 1.15, 0.85], opacity: [0.7, 1, 0.7] }}
            transition={{ duration: 1.8, ease: 'easeInOut', repeat: Infinity }}
          />
        ) : null}
      </motion.svg>
    </div>
  )
}
