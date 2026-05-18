import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'

import { useAppStore } from '@/state'

type AnimatedNumberProps = {
  value: number
  format: (v: number) => string
  duration?: number
}

function AnimatedNumber({ value, format, duration = 600 }: AnimatedNumberProps) {
  const [displayed, setDisplayed] = useState(value)
  const fromRef = useRef(value)
  const startTsRef = useRef<number | null>(null)
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    if (value === displayed) return
    fromRef.current = displayed
    startTsRef.current = performance.now()
    const target = value
    const step = (now: number): void => {
      const start = startTsRef.current ?? now
      const t = Math.min(1, (now - start) / duration)
      const eased = 1 - Math.pow(1 - t, 3)
      const v = fromRef.current + (target - fromRef.current) * eased
      setDisplayed(v)
      if (t < 1) rafRef.current = requestAnimationFrame(step)
      else rafRef.current = null
    }
    rafRef.current = requestAnimationFrame(step)
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
    // displayed intentionally omitted: we only re-target when `value` changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, duration])

  return (
    <AnimatePresence mode="popLayout">
      <motion.span
        key={format(displayed)}
        initial={{ y: '0.5em', opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: '-0.5em', opacity: 0 }}
        transition={{ duration: 0.25, ease: 'easeOut' }}
        style={{ display: 'inline-block' }}
      >
        {format(displayed)}
      </motion.span>
    </AnimatePresence>
  )
}

function formatCount(n: number): string {
  return Math.round(n).toLocaleString()
}

function formatTokens(n: number): string {
  const v = Math.round(n)
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`
  if (v >= 10_000) return `${(v / 1_000).toFixed(1)}k`
  return v.toLocaleString()
}

function formatCost(n: number): string {
  if (n >= 100) return `$${n.toFixed(0)}`
  if (n >= 10) return `$${n.toFixed(1)}`
  return `$${n.toFixed(3)}`
}

export function StatsTicker() {
  const tokens = useAppStore((s) => s.tokens)
  const cost = useAppStore((s) => s.cost)

  const queries = tokens.callsCompleted + tokens.callsFailed
  const tokenTotal = tokens.promptTokens + tokens.completionTokens
  const billed = cost.billedUsd ?? 0
  const ceiling = cost.ceilingUsd ?? 0

  return (
    <div className="stats-ticker" aria-label="Run statistics">
      <StatRow
        label="queries"
        value={<AnimatedNumber value={queries} format={formatCount} />}
      />
      <StatRow
        label="tokens"
        value={<AnimatedNumber value={tokenTotal} format={formatTokens} />}
      />
      <StatRow
        label="cost"
        value={
          <span>
            <AnimatedNumber value={billed} format={formatCost} />
            <span className="stats-ticker__ceiling"> / ${ceiling.toFixed(0)}</span>
          </span>
        }
      />
    </div>
  )
}

function StatRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="stats-ticker__row">
      <span className="stats-ticker__label">{label}</span>
      <span className="stats-ticker__value">{value}</span>
    </div>
  )
}
