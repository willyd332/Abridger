import { useCallback, useEffect, useRef, useState } from 'react'
import { AncientLibraryShell } from '@/components/layout/AncientLibraryShell'
import { MobileBlock } from '@/components/layout/MobileBlock'
import { WelcomeOverlay } from '@/components/layout/WelcomeOverlay'
import { PastRunsOverlay, RESUME_PAST_RUN_EVENT, type ResumePastRunDetail } from '@/components/layout/PastRunsOverlay'
import { IntakeScreen, type IntakeParams } from '@/components/upload/IntakeScreen'
import { BuildingScreen } from '@/components/building/BuildingScreen'
import { StatsTicker } from '@/components/building/StatsTicker'
import { CurateScreen } from '@/components/curate/CurateScreen'
import { BudgetPauseModal } from '@/components/curate/BudgetPauseModal'
import { ExportPanel, type ExportFormat } from '@/components/curate/ExportPanel'
import { SuggestAbridgementModal } from '@/components/curate/SuggestAbridgementModal'
import {
  getAppStore,
  useAppStore,
} from '@/state'
import { books } from '@/state/persistence'
import type { PhaseEvent } from '@/pipeline/types'
import {
  startOntologyRun,
  type OntologyRunHandle,
  type StartOntologyRunResult,
} from '@/pipeline/ontology/orchestrate'
import { exportToPdf } from '@/pipeline/ontology/export-pdf'
import { exportToEpub } from '@/pipeline/ontology/export-epub'
import { findDependencies } from '@/pipeline/ontology/find-dependencies'
import { suggestAbridgement } from '@/pipeline/ontology/suggest-abridgement'
import { LLMClient } from '@/llm/client'

type Stage = 'intake' | 'building' | 'curating' | 'errored'

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function describeError(result: Extract<StartOntologyRunResult, { ok: false }>): string {
  if (result.reason === 'budget-too-low') return 'The spending ceiling is too low for this book. Try raising it.'
  if (result.reason === 'drm-protected') return 'This file is DRM-protected and cannot be parsed in the browser.'
  if (result.reason === 'password-required') return 'This file is password-protected. Re-upload with the password.'
  if (result.reason === 'no-text-layer') return 'This PDF has no extractable text layer.'
  if (result.reason === 'corrupt') return 'The file appears to be corrupt or unreadable.'
  if (result.reason === 'unsupported-format') return 'This file format is not supported.'
  return result.message || 'Something went wrong while starting the run.'
}

function App() {
  const [stage, setStage] = useState<Stage>('intake')
  const [statusMessage, setStatusMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [errorDetails, setErrorDetails] = useState<string[]>([])
  const [showExport, setShowExport] = useState(false)
  const [showSuggest, setShowSuggest] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [bracketProgress, setBracketProgress] = useState<{
    done: number
    total: number
  } | null>(null)
  const [searchingDependencies, setSearchingDependencies] = useState(false)
  const [budgetPause, setBudgetPause] = useState<{
    billedUsd: number
    ceilingUsd: number
    pendingCount: number
  } | null>(null)
  const handleRef = useRef<OntologyRunHandle | null>(null)
  const unsubRef = useRef<(() => void) | null>(null)
  const recentPhaseErrorsRef = useRef<string[]>([])
  const buildingListenersRef = useRef<Set<(event: PhaseEvent) => void>>(new Set())
  // Ring buffer of recent events so a subscriber that mounts AFTER events
  // have started firing can replay them on connect.
  const eventReplayRef = useRef<PhaseEvent[]>([])
  const EVENT_REPLAY_MAX = 600

  const PHASE_ERROR_BUFFER_MAX = 12

  const tree = useAppStore((s) => s.curate.tree)
  const suggestPending = useAppStore((s) => s.curate.suggestPending)
  const bookRecord = useAppStore((s) => s.job?.book)
  const currentRunId = useAppStore((s) => s.currentRunId)

  // Tear down event subscription on unmount.
  useEffect(() => {
    return () => {
      if (unsubRef.current) unsubRef.current()
      unsubRef.current = null
    }
  }, [])

  // Resume-from-past-runs listener: hydrate the store from IDB and switch to
  // the curating stage. The hydrated run is BROWSE-ONLY because no fresh LLM
  // client is attached — Search dependencies / Suggest / Export will surface
  // a status message asking the user to start a new run.
  useEffect(() => {
    const handler = async (e: Event): Promise<void> => {
      const detail = (e as CustomEvent<ResumePastRunDetail>).detail
      const runId = detail?.runId
      if (!runId) return
      setStatusMessage('Loading run from local storage…')
      try {
        const store = getAppStore().getState()
        // Tear down any in-flight handle / listeners first.
        if (handleRef.current) handleRef.current.cancel()
        handleRef.current = null
        if (unsubRef.current) unsubRef.current()
        unsubRef.current = null
        eventReplayRef.current = []
        store.setCurrentRunId(runId)
        await store.refreshFromDB()
        await store.loadCurateFromDB(runId)
        setShowExport(false)
        setShowSuggest(false)
        setStage('curating')
        setStatusMessage('Run loaded. Browse the tree — start a new run for fresh edits or exports.')
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        setStatusMessage(`Could not resume that run: ${message}`)
      }
    }
    window.addEventListener(RESUME_PAST_RUN_EVENT, handler)
    return () => window.removeEventListener(RESUME_PAST_RUN_EVENT, handler)
  }, [])

  const attachHandle = useCallback((handle: OntologyRunHandle) => {
    if (unsubRef.current) unsubRef.current()
    handleRef.current = handle
    recentPhaseErrorsRef.current = []
    eventReplayRef.current = []
    unsubRef.current = handle.onEvent((event: PhaseEvent) => {
      // Buffer for late-mounting subscribers (BuildingScreen mounts after
      // the first events may have fired).
      eventReplayRef.current.push(event)
      if (eventReplayRef.current.length > EVENT_REPLAY_MAX) {
        eventReplayRef.current.splice(
          0,
          eventReplayRef.current.length - EVENT_REPLAY_MAX,
        )
      }
      // Fan out to building-screen subscribers
      for (const listener of buildingListenersRef.current) {
        try {
          listener(event)
        } catch {
          // listener failures must not break the pipeline
        }
      }
      if (event.kind === 'phase-error') {
        const entry = `[${event.phase}] ${event.error}`
        const next = [...recentPhaseErrorsRef.current, entry]
        recentPhaseErrorsRef.current = next.slice(-PHASE_ERROR_BUFFER_MAX)
        setStatusMessage(`Phase ${event.phase} error: ${event.error.split('\n', 1)[0]}`)
      } else if (event.kind === 'phase-warning') {
        const entry = `[${event.phase}] warning: ${event.warning}`
        recentPhaseErrorsRef.current = [
          ...recentPhaseErrorsRef.current,
          entry,
        ].slice(-PHASE_ERROR_BUFFER_MAX)
      } else if (event.kind === 'phase-start') {
        setStatusMessage(`Phase ${event.phase} started.`)
      } else if (event.kind === 'phase-progress') {
        setStatusMessage(
          `Phase ${event.phase}: ${event.completed} of ${event.total} units complete.`,
        )
      } else if (event.kind === 'budget-pause') {
        if (event.paused) {
          setBudgetPause({
            billedUsd: event.billedUsd,
            ceilingUsd: event.ceilingUsd,
            pendingCount: event.pendingCount,
          })
          setStatusMessage(
            `Spending ceiling reached. ${event.pendingCount} call(s) paused — raise or stop.`,
          )
        } else {
          setBudgetPause(null)
        }
      }
    })
    void handle.result
      .then((completion) => {
        if (!completion.ok) {
          if (completion.reason === 'cancelled') return
          setErrorMessage(completion.message || 'The run failed.')
          setErrorDetails([...recentPhaseErrorsRef.current])
          setStage('errored')
          return
        }
        setStage('curating')
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : 'Unexpected error.'
        setErrorMessage(message)
        setErrorDetails([...recentPhaseErrorsRef.current])
        setStage('errored')
      })
  }, [])

  const handleIntakeBegin = useCallback(
    async (params: IntakeParams) => {
      setErrorMessage('')
      setStage('building')
      setStatusMessage('Parsing the book…')
      const result = await startOntologyRun({
        file: params.file,
        apiKey: params.key,
        provider: params.provider,
        storeKeyLocally: params.storeKeyLocally,
        costCeiling: params.costCeiling,
        frontBackMatterHandling: 'abridge',
      })
      if (!result.ok) {
        setErrorMessage(describeError(result))
        setStage('errored')
        return
      }
      attachHandle(result.handle)
    },
    [attachHandle],
  )

  const handleStartOver = useCallback(() => {
    if (handleRef.current) handleRef.current.cancel()
    handleRef.current = null
    if (unsubRef.current) unsubRef.current()
    unsubRef.current = null
    recentPhaseErrorsRef.current = []
    setStage('intake')
    setStatusMessage('')
    setErrorMessage('')
    setErrorDetails([])
    getAppStore().getState().resetCurate()
  }, [])

  const handleOpenExport = useCallback(() => {
    setShowExport(true)
  }, [])

  const handleExport = useCallback(
    async (format: ExportFormat) => {
      console.log('[export] handleExport invoked', { format })
      const handle = handleRef.current
      const currentTree = getAppStore().getState().curate.tree
      const currentInclusion = getAppStore().getState().curate.inclusion
      const runId = getAppStore().getState().currentRunId
      let book = getAppStore().getState().job?.book ?? null
      console.log('[export] preflight', {
        hasHandle: Boolean(handle),
        hasTree: Boolean(currentTree),
        hasBook: Boolean(book),
        bookFormat: book?.format,
        hasOriginalBlob: Boolean(book?.originalBlob),
        runId,
      })
      // Root-cause guard: the in-memory `book` may have been hydrated from a
      // path that dropped originalBlob (e.g. partial refresh). Fall back to
      // the persisted record from IndexedDB so export never silently fails
      // on a missing blob.
      if ((!book || !book.originalBlob) && runId) {
        console.log('[export] hydrating book from IndexedDB via books.getByRun', { runId })
        try {
          const persisted = await books.getByRun(runId)
          if (persisted) {
            book = persisted
            console.log('[export] hydrated book', {
              format: persisted.format,
              hasOriginalBlob: Boolean(persisted.originalBlob),
              blobSize: persisted.originalBlob?.size,
            })
          } else {
            console.error('[export] books.getByRun returned null', { runId })
          }
        } catch (err) {
          console.error('[export] books.getByRun threw', err)
        }
      }
      if (!handle) {
        console.error('[export] missing run handle — cannot export')
        setStatusMessage('Cannot export: the run handle is gone. Refresh and try again.')
        setShowExport(false)
        return
      }
      if (!currentTree) {
        console.error('[export] missing ontology tree — cannot export')
        setStatusMessage('Cannot export: ontology tree is missing.')
        setShowExport(false)
        return
      }
      if (!book) {
        console.error('[export] missing book record — cannot export')
        setStatusMessage('Cannot export: book record is missing.')
        setShowExport(false)
        return
      }
      if (!book.originalBlob) {
        console.error('[export] missing originalBlob on book record', { bookId: book.bookId })
        setStatusMessage('Cannot export: the original file is no longer available.')
        setShowExport(false)
        return
      }
      setExporting(true)
      setBracketProgress(null)
      const handleBracketDone = (done: number, total: number): void => {
        console.log(`[export] bracket ${done}/${total} done`)
        setBracketProgress({ done, total })
      }
      try {
        setStatusMessage('Generating brackets and editing the original file…')
        const client = handle.client as LLMClient
        console.log('[export] starting', {
          format: book.format,
          rawTextLen: book.parsed.rawText.length,
          blobSize: book.originalBlob.size,
        })
        if (book.format === 'pdf') {
          const out = await exportToPdf({
            tree: currentTree,
            inclusion: currentInclusion,
            bookText: book.parsed.rawText,
            originalBlob: book.originalBlob,
            startPage: book.startPage,
            client,
            onBracketDone: handleBracketDone,
          })
          console.log('[export] pdf export complete', out.stats)
          triggerDownload(out.blob, out.filename)
          setStatusMessage(
            `Saved abridged PDF: ${out.stats.keptPageCount} original pages kept, ${out.stats.summaryPagesInserted} summary pages inserted (${out.stats.bracketCount} brackets).`,
          )
        } else if (book.format === 'epub') {
          const out = await exportToEpub({
            tree: currentTree,
            inclusion: currentInclusion,
            bookText: book.parsed.rawText,
            originalBlob: book.originalBlob,
            parsedBook: book.parsed,
            client,
            onBracketDone: handleBracketDone,
          })
          console.log('[export] epub export complete', out.stats)
          triggerDownload(out.blob, out.filename)
          setStatusMessage(
            `Saved abridged EPUB: ${out.stats.spineItemsKept} spine items kept, ${out.stats.spineItemsBracketed} replaced with brackets.`,
          )
        } else {
          console.error('[export] unsupported source format', { format: book.format })
          setStatusMessage(`Unsupported source format: ${book.format}`)
        }
      } catch (err) {
        console.error('[export] export threw', err)
        const message = err instanceof Error ? err.message : String(err)
        setStatusMessage(`Export failed: ${message}`)
      } finally {
        setExporting(false)
        setBracketProgress(null)
        setShowExport(false)
      }
    },
    [],
  )

  const handleSuggestSubmit = useCallback(
    async (purpose: string, targetCompression: number) => {
      console.log('[suggest] handleSuggestSubmit invoked', {
        purposeLength: purpose.length,
        targetCompression,
      })
      const handle = handleRef.current
      const currentTree = getAppStore().getState().curate.tree
      if (!handle) {
        console.error(
          '[suggest] no live run handle — this run was resumed from past runs',
        )
        setStatusMessage(
          'No live API client. Resumed runs are browse-only — start a new run to use Suggest.',
        )
        getAppStore().getState().setSuggestPending(false)
        setShowSuggest(false)
        return
      }
      if (!currentTree) {
        console.error('[suggest] no ontology tree in store')
        setStatusMessage('Cannot suggest: ontology tree missing from state.')
        getAppStore().getState().setSuggestPending(false)
        setShowSuggest(false)
        return
      }
      const store = getAppStore().getState()
      store.setSuggestPending(true)
      setStatusMessage('The Book Abridger is reading the tree for your purpose…')
      console.log('[suggest] calling suggestAbridgement', {
        nodeCount: Object.keys(currentTree.nodes).length,
        leafCount: currentTree.leafIdsInOrder.length,
      })
      try {
        const result = await suggestAbridgement(
          currentTree,
          purpose,
          handle.client as LLMClient,
          { targetKeepRatio: targetCompression },
        )
        console.log('[suggest] suggestAbridgement returned', {
          excludedNodeIds: result.excludedNodeIds.length,
          excludedLeafIds: result.excludedLeafIds.length,
        })
        await store.applySuggestExclusions(result.excludedLeafIds)
        setStatusMessage(
          result.summary ||
            `Suggestion applied: ${result.excludedLeafIds.length} leaves unchecked.`,
        )
      } catch (err) {
        console.error('[suggest] threw', err)
        const message = err instanceof Error ? err.message : String(err)
        setStatusMessage(`Suggest failed: ${message}`)
      } finally {
        getAppStore().getState().setSuggestPending(false)
        setShowSuggest(false)
      }
    },
    [],
  )

  const handleSearchDependencies = useCallback(async (nodeId: string) => {
    console.log('[deps] handleSearchDependencies invoked', { nodeId })
    const handle = handleRef.current
    const currentTree = getAppStore().getState().curate.tree
    if (!handle) {
      console.error('[deps] no live run handle — resumed run is browse-only')
      setStatusMessage(
        'No live API client. Resumed runs are browse-only — start a new run to search dependencies.',
      )
      return
    }
    if (!currentTree) {
      console.error('[deps] no ontology tree')
      setStatusMessage('Cannot search: ontology tree missing from state.')
      return
    }
    setSearchingDependencies(true)
    setStatusMessage('Searching downstream dependencies…')
    try {
      const deps = await findDependencies(
        currentTree,
        nodeId,
        handle.client as LLMClient,
      )
      await getAppStore().getState().storeDependencies(deps)
      setStatusMessage(`Found ${deps.downstream.length} downstream dependencies.`)
    } catch (err) {
      console.error('[deps] threw', err)
      const message = err instanceof Error ? err.message : String(err)
      setStatusMessage(`Dependency search failed: ${message}`)
    } finally {
      setSearchingDependencies(false)
    }
  }, [])

  const subscribeBuilding = useCallback(
    (listener: (event: PhaseEvent) => void) => {
      // Replay buffered events for late-mounting subscribers so the cascade
      // and tree don't start mid-stream.
      for (const event of eventReplayRef.current) {
        try {
          listener(event)
        } catch {
          // ignore
        }
      }
      buildingListenersRef.current.add(listener)
      return () => {
        buildingListenersRef.current.delete(listener)
      }
    },
    [],
  )

  const handleRaiseCeiling = useCallback((newCeilingUsd: number) => {
    const handle = handleRef.current
    if (!handle) return
    console.log('[budget] raising ceiling', { from: budgetPause?.ceilingUsd, to: newCeilingUsd })
    handle.raiseCeiling(newCeilingUsd)
    // Reflect the new ceiling in the store immediately so the StatsTicker
    // shows the right denominator. The meter's pause-state-change callback
    // will close the modal when the queue drains.
    getAppStore().setState((s) => ({
      cost: { ...s.cost, ceilingUsd: newCeilingUsd },
    }))
  }, [budgetPause?.ceilingUsd])

  const handleStopBudgetWait = useCallback(() => {
    const handle = handleRef.current
    if (!handle) return
    console.warn('[budget] user stopping — partial tree will be kept')
    handle.cancelBudgetWait()
  }, [])

  return (
    <>
      <MobileBlock />
      {/* Persistent run-stats ticker — fixed bottom-right. Stays visible
          across building, curating, and exporting so the user sees the
          cumulative cost of every call (build, suggest, dependencies,
          bracket-writer). Hidden only on the intake screen. */}
      {currentRunId ? <StatsTicker /> : null}
      {/* Budget pause modal — top-level so it overlays building, curating,
          and any in-progress export. Driven by `budget-pause` PhaseEvents
          emitted from the cost meter's pause handler. */}
      <BudgetPauseModal
        open={budgetPause !== null}
        billedUsd={budgetPause?.billedUsd ?? 0}
        ceilingUsd={budgetPause?.ceilingUsd ?? 0}
        pendingCount={budgetPause?.pendingCount ?? 0}
        onRaise={handleRaiseCeiling}
        onStop={handleStopBudgetWait}
      />
      {stage === 'building' ? (
        <BuildingScreen
          subscribe={subscribeBuilding}
          onCancel={() => {
            handleRef.current?.cancel()
            handleStartOver()
          }}
        />
      ) : null}
      <AncientLibraryShell statusMessage={statusMessage} onHome={handleStartOver}>
        <WelcomeOverlay />
        <PastRunsOverlay />

        {stage === 'building' ? null : stage === 'curating' && tree ? (
          <>
            <CurateScreen
              bookText={bookRecord?.parsed.rawText ?? null}
              onExport={handleOpenExport}
              onOpenSuggest={() => setShowSuggest(true)}
              onSearchDependencies={handleSearchDependencies}
              searchingDependencies={searchingDependencies}
            />
            <ExportPanel
              open={showExport}
              onClose={() => setShowExport(false)}
              onExport={handleExport}
              defaultFormat={bookRecord?.format === 'epub' ? 'epub' : 'pdf'}
              exporting={exporting}
              bracketProgress={bracketProgress}
            />
            <SuggestAbridgementModal
              open={showSuggest}
              onClose={() => setShowSuggest(false)}
              onSubmit={handleSuggestSubmit}
              pending={suggestPending}
            />
          </>
        ) : stage === 'errored' ? (
          <ErrorPanel
            message={errorMessage}
            details={errorDetails}
            onStartOver={handleStartOver}
          />
        ) : (
          <IntakeScreen onBegin={handleIntakeBegin} />
        )}
      </AncientLibraryShell>
    </>
  )
}

interface ErrorPanelProps {
  message: string
  details: string[]
  onStartOver: () => void
}

function ErrorPanel({ message, details, onStartOver }: ErrorPanelProps) {
  const detailsBody = details.length > 0 ? details.join('\n\n') : ''
  return (
    <section className="error-panel parchment-card" aria-live="assertive">
      <h2 style={{ marginTop: 0 }}>The press has stopped.</h2>
      <p style={{ color: 'var(--shell-ink-soft)', fontStyle: 'italic', margin: '0 0 0.6rem' }}>
        Something went wrong during the build phase. The details below should
        explain what happened.
      </p>
      <ErrorBlock label="What failed" body={message || 'An unknown error occurred.'} />
      {detailsBody ? <ErrorBlock label="Activity log (most recent phase errors)" body={detailsBody} /> : null}
      <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', marginTop: '1rem' }}>
        <button
          type="button"
          className="gilt-button gilt-button--primary"
          onClick={onStartOver}
        >
          Start over
        </button>
      </div>
    </section>
  )
}

function ErrorBlock({ label, body }: { label: string; body: string }) {
  return (
    <div style={{ margin: '0 0 0.75rem' }}>
      <div
        style={{
          fontSize: '0.74rem',
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          color: 'var(--shell-ink-faint)',
          marginBottom: '0.25rem',
        }}
      >
        {label}
      </div>
      <pre
        style={{
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          fontFamily: 'var(--shell-mono, ui-monospace, "SF Mono", monospace)',
          fontSize: '0.82rem',
          lineHeight: 1.45,
          color: 'var(--shell-ink)',
          background: 'var(--shell-accent-soft, rgba(184,135,70,0.08))',
          padding: '0.85rem 1rem',
          borderRadius: '0.4rem',
          border: '1px solid var(--shell-edge, rgba(0,0,0,0.18))',
          maxHeight: '20rem',
          overflow: 'auto',
          margin: 0,
        }}
      >
        {body}
      </pre>
    </div>
  )
}

export default App
