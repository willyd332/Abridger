import { useCallback } from 'react'
import { Button } from '@/components/ui/Button'
import type { OutputRecord, OutputKind } from '@/state'

interface DownloadPanelProps {
  outputs: OutputRecord[]
  filenameBase?: string
}

function defaultExtension(kind: OutputKind): string {
  if (kind === 'abridged-pdf') return 'pdf'
  if (kind === 'abridged-epub') return 'epub'
  return 'md'
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.rel = 'noopener'
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  setTimeout(() => URL.revokeObjectURL(url), 500)
}

function buildFilename(kind: OutputKind, base: string): string {
  const ext = defaultExtension(kind)
  if (kind === 'ledger-md') return `${base}-ledger.${ext}`
  return `${base}-abridged.${ext}`
}

function findOutput(outputs: OutputRecord[], kind: OutputKind): OutputRecord | undefined {
  return outputs.find((o) => o.kind === kind)
}

export function DownloadPanel({ outputs, filenameBase = 'abridger' }: DownloadPanelProps) {
  const abridged = findOutput(outputs, 'abridged-pdf') ?? findOutput(outputs, 'abridged-epub')
  const ledger = findOutput(outputs, 'ledger-md')

  const handleDownloadAbridged = useCallback(() => {
    if (!abridged) return
    downloadBlob(abridged.blob, buildFilename(abridged.kind, filenameBase))
  }, [abridged, filenameBase])

  const handleDownloadLedger = useCallback(() => {
    if (!ledger) return
    downloadBlob(ledger.blob, buildFilename(ledger.kind, filenameBase))
  }, [ledger, filenameBase])

  return (
    <div className="download-panel" role="group" aria-label="Downloads">
      <Button
        variant="primary"
        glow={!!abridged}
        onClick={handleDownloadAbridged}
        disabled={!abridged}
        aria-label="Download abridged file"
      >
        Download abridged {abridged?.kind === 'abridged-pdf' ? 'PDF' : 'EPUB'}
      </Button>
      <Button
        variant="ghost"
        onClick={handleDownloadLedger}
        disabled={!ledger}
        aria-label="Download ledger markdown"
      >
        Download ledger (.md)
      </Button>
    </div>
  )
}
