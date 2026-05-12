import type { ReactNode } from 'react'

type PillTone = 'neutral' | 'success' | 'warn' | 'muted'

interface PillProps {
  tone?: PillTone
  children: ReactNode
  ariaLabel?: string
}

const toneClass: Record<PillTone, string> = {
  neutral: '',
  success: 'gilt-pill--success',
  warn: 'gilt-pill--warn',
  muted: 'gilt-pill--muted',
}

export function Pill({ tone = 'neutral', children, ariaLabel }: PillProps) {
  return (
    <span className={`gilt-pill ${toneClass[tone]}`} aria-label={ariaLabel}>
      {children}
    </span>
  )
}
