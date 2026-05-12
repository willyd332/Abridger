import { useId } from 'react'

interface PurposePromptProps {
  value: string
  onChange: (value: string) => void
  maxLength?: number
}

const DEFAULT_MAX = 600

export function PurposePrompt({
  value,
  onChange,
  maxLength = DEFAULT_MAX,
}: PurposePromptProps) {
  const id = useId()
  const count = value.length
  const trimmed = value.trim().length

  return (
    <div>
      <label
        htmlFor={id}
        style={{
          display: 'block',
          fontSize: '0.85rem',
          color: 'var(--shell-ink-soft)',
          marginBottom: '0.4rem',
        }}
      >
        Reading purpose
      </label>
      <textarea
        id={id}
        className="parchment-textarea"
        value={value}
        maxLength={maxLength}
        onChange={(event) => onChange(event.target.value)}
        placeholder="e.g. I am reading this for the central argument about moral luck; preserve the famous thought experiments and the author's voice."
        aria-describedby={`${id}-meta`}
      />
      <div
        id={`${id}-meta`}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginTop: '0.55rem',
          gap: '0.6rem',
        }}
      >
        <span
          style={{
            fontSize: '0.82rem',
            color:
              trimmed === 0 ? 'var(--shell-ink-faint)' : 'var(--shell-ink-soft)',
            fontStyle: 'italic',
            lineHeight: 1.4,
          }}
        >
          {trimmed === 0
            ? 'A sentence or two is enough. Why are you reading this book?'
            : 'Every downstream decision sees this purpose alongside the book.'}
        </span>
        <span
          className="wax-seal"
          aria-label={`${count} of ${maxLength} characters used`}
        >
          {count}
        </span>
      </div>
    </div>
  )
}
