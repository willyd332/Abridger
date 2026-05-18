import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AnimatePresence,
  motion,
  useAnimationControls,
  useReducedMotion,
} from 'motion/react'

import type { PhaseSampleSource } from '@/pipeline/types'

export type CascadeDepth = 'far' | 'mid' | 'near'

export type CascadeItem = {
  id: string
  source: PhaseSampleSource
  text: string
  bornAt: number
  durationMs: number
  laneX: number
  fontScale: number
  depth: CascadeDepth
  driftX: number
  rotate: number
}

interface Props {
  pendingSamples: Array<{ source: PhaseSampleSource; text: string }>
  onConsume: (count: number) => void
}

const MAX_ON_SCREEN = 120
const SPAWN_INTERVAL_MS = 55
const LANE_WIDTH = 50

type DepthConfig = {
  weight: number
  fontScale: [number, number]
  durationMs: [number, number]
  opacityPeak: number
  blurPx: number
  letterSpacing: string
}

// Same per-tier spread as before, shifted +5s slower across the board.
const DEPTH_TIERS: Record<CascadeDepth, DepthConfig> = {
  far: {
    weight: 0.45,
    fontScale: [0.55, 0.75],
    durationMs: [14000, 18000],
    opacityPeak: 0.45,
    blurPx: 1.6,
    letterSpacing: '0.01em',
  },
  mid: {
    weight: 0.35,
    fontScale: [0.85, 1.05],
    durationMs: [10500, 13000],
    opacityPeak: 0.78,
    blurPx: 0.4,
    letterSpacing: '0.005em',
  },
  near: {
    weight: 0.2,
    fontScale: [1.15, 1.45],
    durationMs: [8200, 10000],
    opacityPeak: 1,
    blurPx: 0,
    letterSpacing: '0',
  },
}

function pickDepth(rng: () => number): CascadeDepth {
  const r = rng()
  let acc = 0
  for (const depth of ['far', 'mid', 'near'] as CascadeDepth[]) {
    acc += DEPTH_TIERS[depth].weight
    if (r < acc) return depth
  }
  return 'mid'
}

function pickRange(rng: () => number, [a, b]: [number, number]): number {
  return a + rng() * (b - a)
}

const ANCHOR_POINTS = [-10, 4, 20, 36, 48]
function pickLaneX(rng: () => number): number {
  const idx = Math.floor(rng() * ANCHOR_POINTS.length)
  const jitter = (rng() - 0.5) * 8
  return ANCHOR_POINTS[idx] + jitter
}

function pickDrift(rng: () => number, depth: CascadeDepth): number {
  const max = depth === 'far' ? 6 : depth === 'mid' ? 3 : 1.5
  return (rng() - 0.5) * 2 * max
}

function pickRotate(rng: () => number): number {
  return (rng() - 0.5) * 2.2
}

export function ThoughtCascade({ pendingSamples, onConsume }: Props) {
  const reduced = useReducedMotion()
  const [items, setItems] = useState<CascadeItem[]>([])

  const itemsRef = useRef<CascadeItem[]>([])
  itemsRef.current = items

  const queueRef = useRef<Array<{ source: PhaseSampleSource; text: string }>>([])
  const idCounterRef = useRef(0)
  const lastSpawnRef = useRef<number>(0)
  const reducedRef = useRef(reduced)
  reducedRef.current = reduced
  const recentReducedRef = useRef<Array<{ source: PhaseSampleSource; text: string }>>([])

  useEffect(() => {
    if (pendingSamples.length === 0) return
    queueRef.current.push(...pendingSamples)
    if (queueRef.current.length > 400) {
      queueRef.current.splice(0, queueRef.current.length - 400)
    }
    if (reducedRef.current) {
      recentReducedRef.current = [
        ...recentReducedRef.current,
        ...pendingSamples,
      ].slice(-8)
    }
    onConsume(pendingSamples.length)
  }, [pendingSamples, onConsume])

  useEffect(() => {
    if (reduced) return
    let raf = 0
    const rng = Math.random
    const tick = (now: number): void => {
      let nextItems: CascadeItem[] | null = null
      const inFlight = itemsRef.current.length
      const queueLen = queueRef.current.length
      if (
        queueLen > 0 &&
        inFlight < MAX_ON_SCREEN &&
        now - lastSpawnRef.current >= SPAWN_INTERVAL_MS
      ) {
        const sample = queueRef.current.shift()
        if (sample) {
          lastSpawnRef.current = now
          idCounterRef.current += 1
          const depth = pickDepth(rng)
          const tier = DEPTH_TIERS[depth]
          const item: CascadeItem = {
            id: `cascade-${idCounterRef.current}`,
            source: sample.source,
            text: sample.text,
            bornAt: now,
            durationMs: pickRange(rng, tier.durationMs),
            laneX: pickLaneX(rng),
            fontScale: pickRange(rng, tier.fontScale),
            depth,
            driftX: pickDrift(rng, depth),
            rotate: pickRotate(rng),
          }
          nextItems = [...itemsRef.current, item]
        }
      }
      // Tail buffer is generous so a held item can outlive its planned fall.
      const source = nextItems ?? itemsRef.current
      const pruned = source.filter(
        (it) => now - it.bornAt < it.durationMs + 60000,
      )
      if (pruned.length !== source.length) {
        nextItems = pruned
      }
      if (nextItems !== null) setItems(nextItems)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [reduced])

  const handleExpire = useCallback((id: string) => {
    setItems((prev) => prev.filter((it) => it.id !== id))
  }, [])

  if (reduced) {
    return (
      <div className="cascade" aria-hidden="true">
        {recentReducedRef.current.map((s, i) => (
          <div
            key={i}
            className={`cascade__line cascade__line--${s.source}`}
            style={{
              position: 'static',
              padding: '0.4rem 1.4rem',
              opacity: 0.85,
            }}
          >
            {s.text}
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="cascade">
      <AnimatePresence>
        {items.map((it) => (
          <CascadeLine key={it.id} item={it} onExpire={handleExpire} />
        ))}
      </AnimatePresence>
    </div>
  )
}

interface LineProps {
  item: CascadeItem
  onExpire: (id: string) => void
}

function CascadeLine({ item, onExpire }: LineProps) {
  const controls = useAnimationControls()
  const tier = DEPTH_TIERS[item.depth] ?? DEPTH_TIERS.mid
  const baseZ = item.depth === 'near' ? 30 : item.depth === 'mid' ? 20 : 10

  const startedAtRef = useRef<number>(0)
  const elapsedMsRef = useRef<number>(0)
  const isHeldRef = useRef<boolean>(false)
  const expireTimerRef = useRef<number | null>(null)
  const [held, setHeld] = useState(false)

  const scheduleExpire = useCallback(
    (delayMs: number) => {
      if (expireTimerRef.current !== null) {
        window.clearTimeout(expireTimerRef.current)
      }
      expireTimerRef.current = window.setTimeout(() => {
        if (!isHeldRef.current) onExpire(item.id)
      }, delayMs)
    },
    [item.id, onExpire],
  )

  const run = useCallback(
    (remainingMs: number) => {
      const seconds = Math.max(0.2, remainingMs / 1000)
      void controls.start({
        y: '112vh',
        x: `${item.driftX}vw`,
        opacity: [tier.opacityPeak, tier.opacityPeak, 0],
        rotate: item.rotate,
        transition: {
          y: { duration: seconds, ease: [0.42, 0, 0.58, 1] },
          x: { duration: seconds, ease: 'easeInOut' },
          rotate: { duration: seconds, ease: 'linear' },
          opacity: {
            duration: seconds,
            times: [0, 0.78, 1],
            ease: 'linear',
          },
        },
      })
    },
    [controls, item.driftX, item.rotate, tier.opacityPeak],
  )

  useEffect(() => {
    startedAtRef.current = performance.now()
    // mountedRef gates the second controls.start() call in the .then chain.
    // If the line unmounts during its fade-in (e.g. pruned by the parent's
    // RAF loop while the fade-in promise is still pending), the resolved
    // callback fires AFTER controls has been detached — motion then throws
    // "controls.start() should only be called after a component has mounted."
    // Suppressed via the mountedRef guard plus a defensive catch on each
    // .start() call so the unhandled rejection cannot bubble out.
    const mountedRef = { current: true }
    const fadeInMs = Math.min(900, item.durationMs * 0.12)
    controls
      .start({
        opacity: tier.opacityPeak,
        transition: { duration: fadeInMs / 1000, ease: 'linear' },
      })
      .then(() => {
        if (!mountedRef.current) return
        if (isHeldRef.current) return
        run(item.durationMs - fadeInMs)
      })
      .catch(() => {
        // motion rejects when the host unmounts mid-animation; benign.
      })
    scheduleExpire(item.durationMs + 300)
    return () => {
      mountedRef.current = false
      if (expireTimerRef.current !== null) {
        window.clearTimeout(expireTimerRef.current)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      try {
        e.currentTarget.setPointerCapture(e.pointerId)
      } catch {
        // ignore
      }
      elapsedMsRef.current = performance.now() - startedAtRef.current
      isHeldRef.current = true
      if (expireTimerRef.current !== null) {
        window.clearTimeout(expireTimerRef.current)
        expireTimerRef.current = null
      }
      controls.stop()
      setHeld(true)
    },
    [controls],
  )

  const handleRelease = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!isHeldRef.current) return
      try {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.currentTarget.releasePointerCapture(e.pointerId)
        }
      } catch {
        // ignore
      }
      isHeldRef.current = false
      setHeld(false)
      const remaining = Math.max(400, item.durationMs - elapsedMsRef.current)
      startedAtRef.current = performance.now() - elapsedMsRef.current
      run(remaining)
      scheduleExpire(remaining + 300)
    },
    [item.durationMs, run, scheduleExpire],
  )

  return (
    <motion.div
      className={
        `cascade__line cascade__line--${item.source} cascade__line--${item.depth}` +
        (held ? ' cascade__line--held' : '')
      }
      style={{
        left: `${item.laneX}%`,
        width: `${LANE_WIDTH}%`,
        fontSize: `${0.95 * item.fontScale}rem`,
        filter:
          tier.blurPx > 0 && !held ? `blur(${tier.blurPx}px)` : undefined,
        letterSpacing: tier.letterSpacing,
        zIndex: held ? 200 : baseZ,
        cursor: held ? 'grabbing' : 'grab',
        touchAction: 'none',
      }}
      initial={{ y: '-12vh', x: 0, opacity: 0, rotate: item.rotate }}
      animate={controls}
      exit={{ opacity: 0 }}
      onPointerDown={handlePointerDown}
      onPointerUp={handleRelease}
      onPointerCancel={handleRelease}
    >
      {item.text}
    </motion.div>
  )
}
