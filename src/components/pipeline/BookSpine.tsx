import { motion, useReducedMotion } from 'motion/react'

interface BookSpineProps {
  totalSections: number
  active: boolean
}

const MAX_DIVIDERS = 24

export function BookSpine({ totalSections, active }: BookSpineProps) {
  const reduced = useReducedMotion()
  const dividerCount = Math.min(MAX_DIVIDERS, Math.max(0, totalSections))
  const dividers = Array.from({ length: dividerCount }, (_, i) => i)

  return (
    <div className="book-spine" aria-hidden={!active}>
      <svg
        viewBox="0 0 360 80"
        xmlns="http://www.w3.org/2000/svg"
        role="img"
        aria-label="Book spine with section dividers"
        className="book-spine__svg"
      >
        <defs>
          <linearGradient id="spine-cover" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#4a3322" />
            <stop offset="100%" stopColor="#2a1810" />
          </linearGradient>
        </defs>
        <rect x="4" y="14" width="352" height="52" fill="url(#spine-cover)" rx="3" />
        <rect
          x="8"
          y="18"
          width="344"
          height="44"
          fill="none"
          stroke="#b8860b"
          strokeWidth="0.8"
          opacity="0.55"
          rx="2"
        />
        {dividers.map((i) => {
          const x = 12 + ((i + 1) * 336) / (dividerCount + 1)
          return (
            <motion.line
              key={i}
              x1={x}
              x2={x}
              y1={18}
              y2={62}
              stroke="#b8860b"
              strokeWidth="1"
              initial={reduced ? false : { pathLength: 0, opacity: 0 }}
              animate={{ pathLength: 1, opacity: active ? 0.85 : 0.4 }}
              transition={{
                duration: reduced ? 0.2 : 0.45,
                delay: reduced ? 0 : i * 0.04,
              }}
            />
          )
        })}
      </svg>
      <p className="book-spine__caption">
        {totalSections > 0
          ? `${totalSections} section${totalSections === 1 ? '' : 's'} detected`
          : 'Finding section boundaries…'}
      </p>
    </div>
  )
}
