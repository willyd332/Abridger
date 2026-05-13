import { useEffect, useState } from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'motion/react'
import { books, outputs, runs } from '@/state'
import type { OutputRecord, RunRecord } from '@/state'

export const OPEN_PAST_RUNS_EVENT = 'abridger:open-past-runs'

interface RunSummary {
  run: RunRecord
  bookTitle: string
  originalFileName: string
  outputs: OutputRecord[]
}

function formatDate(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function statusLabel(s: RunRecord['status']): string {
  if (s === 'done') return 'Done'
  if (s === 'in_progress') return 'In progress'
  if (s === 'paused') return 'Paused'
  if (s === 'cancelled') return 'Cancelled'
  if (s === 'errored') return 'Errored'
  return s
}

function downloadBlob(blob: Blob, suggestedFilename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = suggestedFilename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 250)
}

function kindExtension(kind: OutputRecord['kind']): string {
  if (kind === 'abridged-pdf') return 'pdf'
  if (kind === 'abridged-epub') return 'epub'
  if (kind === 'ledger-md') return 'md'
  return 'bin'
}

function kindLabel(kind: OutputRecord['kind']): string {
  if (kind === 'abridged-pdf') return 'Abridged PDF'
  if (kind === 'abridged-epub') return 'Abridged EPUB'
  if (kind === 'ledger-md') return 'Ledger (.md)'
  return kind
}

async function loadAll(): Promise<RunSummary[]> {
  const allRuns = await runs.list()
  const summaries: RunSummary[] = []
  for (const run of allRuns) {
    const runOutputs = await outputs.listByRun(run.runId)
    const runBooks = await books.getByRun(run.runId)
    const title = runBooks?.parsed.title ?? null
    const fileName = runBooks?.originalFileName ?? '(unknown file)'
    summaries.push({
      run,
      bookTitle: title ?? fileName,
      originalFileName: fileName,
      outputs: runOutputs,
    })
  }
  return summaries.sort((a, b) => b.run.updatedAt - a.run.updatedAt)
}

export function PastRunsOverlay() {
  const reduced = useReducedMotion()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<RunSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    const handler = () => {
      setOpen(true)
      setLoading(true)
      loadAll()
        .then((rows) => setItems(rows))
        .catch(() => setItems([]))
        .finally(() => setLoading(false))
    }
    window.addEventListener(OPEN_PAST_RUNS_EVENT, handler)
    return () => window.removeEventListener(OPEN_PAST_RUNS_EVENT, handler)
  }, [])

  const dismiss = () => setOpen(false)

  const handleDownload = (summary: RunSummary, output: OutputRecord) => {
    const baseName = (summary.bookTitle || summary.originalFileName || 'abridger')
      .replace(/\.[a-z0-9]+$/i, '')
      .replace(/[^a-z0-9-]+/gi, '-')
      .toLowerCase()
    const suffix = output.kind === 'ledger-md' ? '-ledger' : '-abridged'
    const filename = `${baseName}${suffix}.${kindExtension(output.kind)}`
    downloadBlob(output.blob, filename)
  }

  const handleDelete = async (summary: RunSummary) => {
    if (
      typeof window !== 'undefined' &&
      typeof window.confirm === 'function' &&
      !window.confirm(`Delete the run for "${summary.bookTitle}"? Outputs cannot be recovered.`)
    ) {
      return
    }
    setBusy(summary.run.runId)
    try {
      await runs.delete(summary.run.runId)
      setItems((current) => current.filter((r) => r.run.runId !== summary.run.runId))
    } finally {
      setBusy(null)
    }
  }

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="past-runs-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="past-runs-title"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduced ? 0.15 : 0.3, ease: 'easeOut' }}
          onClick={dismiss}
        >
          <motion.section
            className="past-runs-overlay__card parchment-card"
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: reduced ? 0.15 : 0.35, ease: 'easeOut' }}
            onClick={(e) => e.stopPropagation()}
          >
            <header className="past-runs-overlay__head">
              <h2 id="past-runs-title" className="past-runs-overlay__title">Past runs</h2>
              <button
                type="button"
                className="past-runs-overlay__close gilt-button gilt-button--ghost"
                onClick={dismiss}
                aria-label="Close past runs"
              >
                Close
              </button>
            </header>

            <p className="past-runs-overlay__lede">
              Every run lives in this browser's IndexedDB. Close the tab and
              come back; they will still be here. Clearing site data wipes
              them.
            </p>

            {loading ? (
              <p className="past-runs-overlay__empty">Loading…</p>
            ) : items.length === 0 ? (
              <p className="past-runs-overlay__empty">
                No runs yet. The first abridgement you complete will appear
                here.
              </p>
            ) : (
              <ul className="past-runs-overlay__list">
                {items.map((summary) => (
                  <li key={summary.run.runId} className="past-runs-row">
                    <div className="past-runs-row__head">
                      <div className="past-runs-row__title" title={summary.originalFileName}>
                        {summary.bookTitle}
                      </div>
                      <div className="past-runs-row__meta">
                        <span className={`past-runs-row__status past-runs-row__status--${summary.run.status}`}>
                          {statusLabel(summary.run.status)}
                        </span>
                        <span className="past-runs-row__date">{formatDate(summary.run.updatedAt)}</span>
                        <span className="past-runs-row__cost">${summary.run.cost.billedUsd.toFixed(2)}</span>
                      </div>
                    </div>
                    <div className="past-runs-row__purpose" title={summary.run.purpose}>
                      {summary.run.purpose || <em>(no purpose recorded)</em>}
                    </div>
                    <div className="past-runs-row__actions">
                      {summary.outputs.length === 0 ? (
                        <span className="past-runs-row__no-outputs">
                          No outputs persisted for this run.
                        </span>
                      ) : (
                        summary.outputs.map((output) => (
                          <button
                            key={output.kind}
                            type="button"
                            className="gilt-button"
                            onClick={() => handleDownload(summary, output)}
                          >
                            Download {kindLabel(output.kind)}
                          </button>
                        ))
                      )}
                      <button
                        type="button"
                        className="gilt-button gilt-button--ghost past-runs-row__delete"
                        onClick={() => handleDelete(summary)}
                        disabled={busy === summary.run.runId}
                      >
                        Delete
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </motion.section>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}
