import { useCallback, useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'

import { Button } from '@/components/ui/Button'

interface Props {
  open: boolean
  onClose: () => void
  onSubmit: (purpose: string, targetCompression: number) => Promise<void> | void
  pending: boolean
}

const MIN_PURPOSE = 12

export function SuggestAbridgementModal({
  open,
  onClose,
  onSubmit,
  pending,
}: Props) {
  const [purpose, setPurpose] = useState('')
  const [compression, setCompression] = useState(0.5)

  const handleSubmit = useCallback(async () => {
    if (purpose.trim().length < MIN_PURPOSE) return
    await onSubmit(purpose.trim(), compression)
  }, [purpose, compression, onSubmit])

  if (!open) return null

  const valid = purpose.trim().length >= MIN_PURPOSE && !pending

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal">
        <h3 className="modal__title">Suggest an abridgement</h3>
        {pending ? (
          <SuggestLoader />
        ) : (
          <>
            <p className="modal__hint">
              Tell the Book Abridger why you're reading. It will recommend which
              nodes to uncheck — you can still tweak afterward, or revert the
              whole suggestion in one click.
            </p>
            <label
              style={{
                display: 'block',
                fontSize: '0.9rem',
                marginBottom: '0.4rem',
              }}
            >
              Reading purpose
              <textarea
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                placeholder="e.g. I'm preparing a seminar on the political-economy chapters; skip biographical asides."
                rows={4}
                className="parchment-input"
                style={{
                  display: 'block',
                  width: '100%',
                  marginTop: '0.35rem',
                  padding: '0.5rem 0.6rem',
                  resize: 'vertical',
                }}
              />
            </label>
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.6rem',
                fontSize: '0.9rem',
              }}
            >
              Target keep ratio:
              <input
                type="range"
                min={0.1}
                max={0.9}
                step={0.05}
                value={compression}
                onChange={(e) => setCompression(Number(e.target.value))}
                style={{ flex: 1 }}
              />
              <span style={{ minWidth: '3rem', textAlign: 'right' }}>
                {(compression * 100).toFixed(0)}%
              </span>
            </label>
          </>
        )}
        <div className="modal__actions">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          {!pending && (
            <Button onClick={handleSubmit} disabled={!valid}>
              Suggest
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * SuggestLoader: a slowly-stroked gilt arc on an inkwell ring, with a small
 * leading pip. Reduced-motion users get a plain "Thinking…" line.
 */
function SuggestLoader() {
  const reduced = useReducedMotion()

  if (reduced) {
    return (
      <div
        className="suggest-loader suggest-loader--reduced"
        role="status"
        aria-live="polite"
      >
        Thinking…
      </div>
    )
  }

  // Ring geometry: r=26 on a 64×64 viewBox centered at (32, 32).
  // Circumference ≈ 163.4; render a ~33% arc that rotates around the ring.
  const radius = 26
  const circumference = 2 * Math.PI * radius
  const arcLen = circumference * 0.33

  return (
    <div className="suggest-loader" role="status" aria-live="polite">
      <div className="suggest-loader__ring" aria-hidden="true">
        <motion.svg
          className="suggest-loader__ring-svg"
          viewBox="0 0 64 64"
          animate={{ rotate: 360 }}
          transition={{
            duration: 2.6,
            ease: 'linear',
            repeat: Infinity,
          }}
        >
          <circle
            className="suggest-loader__ring-track"
            cx="32"
            cy="32"
            r={radius}
          />
          <motion.circle
            className="suggest-loader__ring-arc"
            cx="32"
            cy="32"
            r={radius}
            // Start arc at the top of the ring (12 o'clock).
            transform="rotate(-90 32 32)"
            strokeDasharray={`${arcLen} ${circumference - arcLen}`}
            animate={{
              strokeDashoffset: [0, -circumference],
              opacity: [0.55, 1, 0.55],
            }}
            transition={{
              strokeDashoffset: {
                duration: 3.6,
                ease: 'linear',
                repeat: Infinity,
              },
              opacity: {
                duration: 2.2,
                ease: 'easeInOut',
                repeat: Infinity,
              },
            }}
          />
          {/* Leading pip riding the arc head. */}
          <motion.circle
            className="suggest-loader__ring-pip"
            cx="32"
            cy="6"
            r={2.2}
            style={{ originX: '32px', originY: '32px' }}
            animate={{ rotate: 360 }}
            transition={{
              duration: 3.6,
              ease: 'linear',
              repeat: Infinity,
            }}
          />
        </motion.svg>
      </div>
      <p className="suggest-loader__status">
        Reading your purpose and weighing each section…
      </p>
    </div>
  )
}
