import { motion, useReducedMotion } from 'motion/react'
import { Button } from '@/components/ui/Button'
import {
  coverOpenReducedVariants,
  coverOpenVariants,
  gentlePulseVariants,
} from '@/lib/motion-presets'

interface CoverProps {
  isOpening: boolean
  onBegin: () => void
  onAnimationComplete: () => void
}

export function Cover({ isOpening, onBegin, onAnimationComplete }: CoverProps) {
  const reduced = useReducedMotion()
  const openVariants = reduced ? coverOpenReducedVariants : coverOpenVariants

  return (
    <motion.section
      className="cover-stage"
      style={{ perspective: 1400, transformStyle: 'preserve-3d' }}
      variants={openVariants}
      initial="closed"
      animate={isOpening ? 'opening' : 'closed'}
      onAnimationComplete={(definition) => {
        if (definition === 'opening') onAnimationComplete()
      }}
      aria-label="Cover screen"
    >
      <motion.div
        className="cover-book"
        variants={reduced ? undefined : gentlePulseVariants}
        initial={reduced ? undefined : 'rest'}
        animate={reduced || isOpening ? undefined : 'pulse'}
        style={{ transformOrigin: 'left center' }}
      >
        <ClosedBookIllustration />
      </motion.div>

      <h1 className="cover-title drop-cap">The Abridger</h1>
      <p className="cover-subtitle">
        Bring a long book to its narrative spine. Choose your purpose, supply
        your key, and let the press begin its careful work.
      </p>

      <Button
        flicker
        glow
        onClick={onBegin}
        aria-label="Begin the abridgement workflow"
        disabled={isOpening}
      >
        Begin
      </Button>
    </motion.section>
  )
}

function ClosedBookIllustration() {
  return (
    <svg
      viewBox="0 0 200 260"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="A closed leather-bound book with gilt accents"
    >
      <defs>
        <linearGradient id="spine" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0%" stopColor="#3a2a18" />
          <stop offset="50%" stopColor="#2a1810" />
          <stop offset="100%" stopColor="#1a0e08" />
        </linearGradient>
        <linearGradient id="cover" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0%" stopColor="#4a3322" />
          <stop offset="100%" stopColor="#322415" />
        </linearGradient>
        <linearGradient id="pages" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0%" stopColor="#f5ecd6" />
          <stop offset="50%" stopColor="#e0cf99" />
          <stop offset="100%" stopColor="#bfa75e" />
        </linearGradient>
      </defs>

      <rect x="22" y="14" width="14" height="240" fill="url(#spine)" rx="2" />
      <rect x="34" y="12" width="148" height="244" fill="url(#cover)" rx="3" />
      <rect x="178" y="20" width="12" height="226" fill="url(#pages)" rx="1" />

      <rect
        x="46"
        y="28"
        width="124"
        height="212"
        fill="none"
        stroke="#b8860b"
        strokeWidth="1.2"
        opacity="0.7"
        rx="2"
      />
      <rect
        x="52"
        y="34"
        width="112"
        height="200"
        fill="none"
        stroke="#b8860b"
        strokeWidth="0.6"
        opacity="0.45"
        rx="1"
      />

      <g transform="translate(108 110)" fill="#b8860b" opacity="0.85">
        <circle r="22" fill="none" stroke="#b8860b" strokeWidth="1.2" />
        <path d="M -10 -2 L 0 -14 L 10 -2 L 0 10 Z" fill="#d8aa28" stroke="#705208" strokeWidth="0.5" />
        <circle r="3.2" fill="#705208" />
      </g>

      <text
        x="108"
        y="200"
        textAnchor="middle"
        fontFamily="EB Garamond, Georgia, serif"
        fontSize="14"
        fill="#b8860b"
        letterSpacing="2"
      >
        A B R I D G E R
      </text>

      <rect x="22" y="14" width="14" height="240" fill="none" stroke="#000" strokeOpacity="0.18" rx="2" />
    </svg>
  )
}
