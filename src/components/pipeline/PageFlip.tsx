import type { ReactNode } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { easeInkFlow } from '@/lib/motion-presets'

interface PageFlipProps {
  filled: boolean
  children: ReactNode
  durationMs?: number
}

export function PageFlip({ filled, children, durationMs = 600 }: PageFlipProps) {
  const reduced = useReducedMotion()

  if (reduced) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: filled ? 1 : 0.6 }}
        transition={{ duration: 0.25 }}
      >
        {children}
      </motion.div>
    )
  }

  return (
    <motion.div
      style={{ perspective: 800, transformStyle: 'preserve-3d' }}
      initial={{ rotateY: -90, opacity: 0 }}
      animate={{ rotateY: filled ? 0 : -10, opacity: filled ? 1 : 0.55 }}
      transition={{ duration: durationMs / 1000, ease: easeInkFlow }}
    >
      {children}
    </motion.div>
  )
}
