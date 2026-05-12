import type { Transition, Variants } from 'motion/react'

export const easeInkFlow: [number, number, number, number] = [0.22, 0.61, 0.36, 1]

export const coverOpenVariants: Variants = {
  closed: {
    rotateY: 0,
    opacity: 1,
    scale: 1,
  },
  opening: {
    rotateY: -110,
    opacity: 0,
    scale: 0.96,
    transition: {
      duration: 1.1,
      ease: easeInkFlow,
    },
  },
}

export const coverOpenReducedVariants: Variants = {
  closed: { opacity: 1 },
  opening: { opacity: 0, transition: { duration: 0.25 } },
}

export const gentlePulseVariants: Variants = {
  rest: { scale: 1, filter: 'drop-shadow(0 0 0 rgba(184,134,11,0))' },
  pulse: {
    scale: [1, 1.012, 1],
    filter: [
      'drop-shadow(0 0 0 rgba(184,134,11,0))',
      'drop-shadow(0 0 14px rgba(184,134,11,0.18))',
      'drop-shadow(0 0 0 rgba(184,134,11,0))',
    ],
    transition: {
      duration: 4.2,
      repeat: Infinity,
      ease: 'easeInOut',
    },
  },
}

export const candleFlickerVariants: Variants = {
  rest: { opacity: 1 },
  flicker: {
    opacity: [1, 0.965, 1, 0.985, 1],
    transition: {
      duration: 5.5,
      repeat: Infinity,
      ease: 'easeInOut',
    },
  },
}

export const fadeInVariants: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0 },
}

export const fadeInTransition: Transition = {
  duration: 0.55,
  ease: easeInkFlow,
}

export const intakeStaggerTransition: Transition = {
  duration: 0.6,
  ease: easeInkFlow,
  staggerChildren: 0.12,
  delayChildren: 0.08,
}

export function chooseVariants(reduced: boolean, full: Variants, fallback: Variants): Variants {
  return reduced ? fallback : full
}
