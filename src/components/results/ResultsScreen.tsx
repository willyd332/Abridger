import { useEffect, useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { Button } from '@/components/ui/Button'
import { outputs as outputsTable } from '@/state'
import type { OutputRecord } from '@/state'
import { DownloadPanel } from './DownloadPanel'
import { LedgerPreview } from './LedgerPreview'
import { StatsRibbon, type RunStats } from './StatsRibbon'

interface ResultsScreenProps {
  runId: string
  stats: RunStats
  onStartOver: () => void
  bookTitle?: string
}

export function ResultsScreen({ runId, stats, onStartOver, bookTitle }: ResultsScreenProps) {
  const reduced = useReducedMotion()
  const [records, setRecords] = useState<OutputRecord[]>([])

  useEffect(() => {
    let cancelled = false
    outputsTable
      .listByRun(runId)
      .then((rows) => {
        if (cancelled) return
        setRecords(rows)
      })
      .catch(() => {
        if (cancelled) return
        setRecords([])
      })
    return () => {
      cancelled = true
    }
  }, [runId])

  const ledger = records.find((r) => r.kind === 'ledger-md')
  const baseName = bookTitle ? bookTitle.replace(/[^a-z0-9-]+/gi, '-').toLowerCase() : 'abridger'

  return (
    <motion.section
      className="results-screen"
      initial={reduced ? false : { opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.55, ease: [0.22, 0.61, 0.36, 1] }}
      aria-label="Results"
    >
      <header className="results-screen__head">
        <h2 className="results-screen__title drop-cap">A new edition</h2>
        <p className="results-screen__lede">
          The press has finished its work. The abridged file and a complete ledger of
          every cut are ready for download.
        </p>
      </header>

      <StatsRibbon stats={stats} />

      <div className="results-screen__downloads">
        <DownloadPanel outputs={records} filenameBase={baseName} />
      </div>

      <div className="results-screen__ledger">
        <LedgerPreview ledger={ledger} />
      </div>

      <footer className="results-screen__foot">
        <Button variant="ghost" onClick={onStartOver} aria-label="Start a new abridgement">
          Abridge another book
        </Button>
      </footer>
    </motion.section>
  )
}
