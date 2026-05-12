import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'

type Variant = 'primary' | 'ghost'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  flicker?: boolean
  glow?: boolean
  children: ReactNode
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', flicker = false, glow = false, children, className, ...rest },
  ref,
) {
  const classes = [
    'gilt-button',
    variant === 'primary' ? 'gilt-button--primary' : 'gilt-button--ghost',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <button
      ref={ref}
      className={classes}
      data-glow={glow ? 'true' : 'false'}
      data-flicker={flicker ? 'true' : 'false'}
      {...rest}
    >
      {children}
    </button>
  )
})
