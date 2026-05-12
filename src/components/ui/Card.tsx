import type { ReactNode } from 'react'

interface CardProps {
  title?: ReactNode
  hint?: ReactNode
  children: ReactNode
  className?: string
  as?: 'section' | 'article' | 'div'
}

export function Card({
  title,
  hint,
  children,
  className,
  as: As = 'section',
}: CardProps) {
  const classes = ['parchment-card', className ?? ''].filter(Boolean).join(' ')
  return (
    <As className={classes}>
      {title ? <h3 className="parchment-card__title">{title}</h3> : null}
      {hint ? <p className="parchment-card__hint">{hint}</p> : null}
      {children}
    </As>
  )
}
