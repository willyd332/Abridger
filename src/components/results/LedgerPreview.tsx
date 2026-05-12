import { useEffect, useState } from 'react'
import { Card } from '@/components/ui/Card'
import type { OutputRecord } from '@/state'

interface LedgerPreviewProps {
  ledger?: OutputRecord
  previewChars?: number
}

const DEFAULT_PREVIEW_CHARS = 600

export function LedgerPreview({ ledger, previewChars = DEFAULT_PREVIEW_CHARS }: LedgerPreviewProps) {
  const [text, setText] = useState<string>('')
  const [full, setFull] = useState<string>('')
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    let cancelled = false
    if (!ledger) {
      setText('')
      setFull('')
      return
    }
    ledger.blob
      .text()
      .then((body) => {
        if (cancelled) return
        setFull(body)
        setText(body.length > previewChars ? `${body.slice(0, previewChars).trimEnd()}…` : body)
      })
      .catch(() => {
        if (cancelled) return
        setText('Ledger preview unavailable.')
      })
    return () => {
      cancelled = true
    }
  }, [ledger, previewChars])

  if (!ledger) {
    return (
      <Card title="Ledger" hint="A full record of every cut and bracket.">
        <p style={{ color: 'var(--shell-ink-faint)', fontStyle: 'italic' }}>
          The ledger will be ready once the run completes.
        </p>
      </Card>
    )
  }

  return (
    <Card title="Ledger" hint="A full record of every cut and bracket.">
      <pre className="ledger-preview__pre">{expanded ? full : text}</pre>
      {full.length > previewChars ? (
        <button
          type="button"
          className="ledger-preview__toggle gilt-button gilt-button--ghost"
          onClick={() => setExpanded((prev) => !prev)}
          aria-expanded={expanded}
        >
          {expanded ? 'Collapse ledger' : 'View full ledger'}
        </button>
      ) : null}
    </Card>
  )
}
