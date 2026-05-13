import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { AncientLibraryShell } from '@/components/layout/AncientLibraryShell'
import { MobileBlock } from '@/components/layout/MobileBlock'
import { WelcomeOverlay } from '@/components/layout/WelcomeOverlay'
import { IntakeScreen, type IntakeParams } from '@/components/upload/IntakeScreen'
import { PipelineView } from '@/components/pipeline/PipelineView'
import { ResumePrompt } from '@/components/pipeline/ResumePrompt'
import { ResultsScreen } from '@/components/results/ResultsScreen'
import {
  findResumableRun,
  getAppStore,
  runs as runsTable,
  useAppStore,
  selectCurrentPhase,
  selectProgress,
  type ModelMapping,
  type ResumableRunSummary,
} from '@/state'
import type { PhaseEvent } from '@/pipeline/types'
import type { Provider } from '@/llm/types'
import {
  startRun as adapterStartRun,
  resumeRun as adapterResumeRun,
  type RunHandle,
  type StartRunResult,
} from '@/components/pipeline/orchestrator-adapter'
import type { RunStats } from '@/components/results/StatsRibbon'

type Stage = 'intake' | 'running' | 'done' | 'errored'

const DEFAULT_MODEL_MAPPING: Record<Provider, ModelMapping> = {
  anthropic: {
    cheap: 'claude-haiku-4-5-20251001',
    smart: 'claude-sonnet-4-6',
    reasoning: 'claude-opus-4-7',
  },
  openai: {
    cheap: 'gpt-4o-mini',
    smart: 'gpt-4o',
    reasoning: 'o1',
  },
}

function describeError(result: Extract<StartRunResult, { ok: false }>): string {
  if (result.reason === 'not-implemented') return result.message
  if (result.reason === 'budget-too-low') return 'The spending ceiling is too low for this book. Try raising it.'
  if (result.reason === 'drm-protected') return 'This file is DRM-protected and cannot be parsed in the browser.'
  if (result.reason === 'password-required') return 'This file is password-protected. Re-upload with the password.'
  if (result.reason === 'no-text-layer') return 'This PDF has no extractable text layer.'
  if (result.reason === 'corrupt') return 'The file appears to be corrupt or unreadable.'
  if (result.reason === 'unsupported-format') return 'This file format is not supported.'
  if (result.reason === 'unsupported') return result.message || 'This run setup is not yet supported.'
  return result.message || 'Something went wrong while starting the run.'
}

function App() {
  const [stage, setStage] = useState<Stage>('intake')
  const [resumable, setResumable] = useState<ResumableRunSummary | null>(null)
  const [showResume, setShowResume] = useState(false)
  const [resumeRunId, setResumeRunId] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState<string>('')
  const [errorMessage, setErrorMessage] = useState<string>('')
  const [provider, setProvider] = useState<Provider | null>(null)
  const [stats, setStats] = useState<RunStats | null>(null)
  const handleRef = useRef<RunHandle | null>(null)
  const unsubRef = useRef<(() => void) | null>(null)

  const currentPhase = useAppStore(selectCurrentPhase)
  const progress = useAppStore(useShallow(selectProgress))
  const runRecord = useAppStore((state) => state.job?.run)
  const bookRecord = useAppStore((state) => state.job?.book)
  const tokens = useAppStore(useShallow((state) => state.tokens))

  // Check for resumable runs on boot
  useEffect(() => {
    let cancelled = false
    findResumableRun()
      .then((match) => {
        if (cancelled || !match) return
        setResumable(match.summary)
        setShowResume(true)
      })
      .catch(() => {
        // No resumable run; proceed normally.
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Push aria-live updates whenever phase/progress moves.
  useEffect(() => {
    if (stage !== 'running' || !currentPhase) return
    setStatusMessage(
      progress.total > 0
        ? `Phase ${currentPhase}: ${progress.done} of ${progress.total} sections complete.`
        : `Phase ${currentPhase} in progress.`,
    )
  }, [stage, currentPhase, progress.done, progress.total])

  // Tear down event subscription on unmount.
  useEffect(() => {
    return () => {
      if (unsubRef.current) unsubRef.current()
      unsubRef.current = null
    }
  }, [])

  const attachHandle = useCallback((handle: RunHandle) => {
    if (unsubRef.current) unsubRef.current()
    handleRef.current = handle
    unsubRef.current = handle.onEvent((event: PhaseEvent) => {
      if (event.kind === 'phase-error') {
        setStatusMessage(`Phase ${event.phase} error: ${event.error}`)
      } else if (event.kind === 'phase-progress') {
        void getAppStore().getState().refreshFromDB()
      } else if (event.kind === 'phase-end') {
        void getAppStore().getState().refreshFromDB()
      }
    })
    if (handle.result) {
      void handle.result
        .then(async (completion) => {
          await getAppStore().getState().refreshFromDB()
          if (!completion.ok) {
            if (completion.reason === 'cancelled') return
            setErrorMessage(completion.message || 'The run failed.')
            setStage('errored')
          }
        })
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : 'Unexpected error.'
          setErrorMessage(message)
          setStage('errored')
        })
    }
  }, [])

  const handleIntakeBegin = useCallback(
    async (params: IntakeParams) => {
      setProvider(params.provider)
      setErrorMessage('')
      setStage('running')
      setStatusMessage('Starting the press…')
      const result = await adapterStartRun({
        file: params.file,
        apiKey: params.key,
        provider: params.provider,
        purpose: params.purpose,
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

  const handleResumeAccept = useCallback(async () => {
    if (!resumable) return
    setShowResume(false)
    setStage('running')
    setResumeRunId(resumable.runId)
    setStatusMessage('Resuming the previous run…')
    const result = await adapterResumeRun(resumable.runId)
    if (!result.ok) {
      setErrorMessage(describeError(result))
      setStage('errored')
      return
    }
    attachHandle(result.handle)
  }, [attachHandle, resumable])

  const handleResumeDiscard = useCallback(async () => {
    if (resumable) {
      try {
        await runsTable.update(resumable.runId, { status: 'cancelled' })
      } catch {
        // Best-effort cleanup; resume will not re-trigger on next boot.
      }
    }
    setShowResume(false)
    setResumable(null)
  }, [resumable])

  const handlePause = useCallback(() => {
    handleRef.current?.pause()
    void getAppStore().getState().pauseRun()
  }, [])

  const handleResumeFromRibbon = useCallback(() => {
    const handle = handleRef.current
    if (handle?.resume) {
      handle.resume()
    }
    const runId = runRecord?.runId
    if (runId) void getAppStore().getState().resumeRun(runId)
  }, [runRecord?.runId])

  const handleCancel = useCallback(() => {
    const ok =
      typeof window !== 'undefined' && typeof window.confirm === 'function'
        ? window.confirm(
            'Halt this run? Partial work is saved; you can resume from your browser cache later.',
          )
        : true
    if (!ok) return
    handleRef.current?.cancel()
    void getAppStore().getState().cancelRun()
    setStage('errored')
    setErrorMessage('Run cancelled.')
  }, [])

  const handleStartOver = useCallback(() => {
    handleRef.current = null
    if (unsubRef.current) unsubRef.current()
    unsubRef.current = null
    setStats(null)
    setStage('intake')
    setStatusMessage('')
    setErrorMessage('')
    setResumeRunId(null)
  }, [])

  // Watch for completion: build stats and transition to done.
  useEffect(() => {
    if (stage !== 'running' || !runRecord) return
    if (runRecord.status !== 'done') return
    const originalPages = bookRecord?.parsed.pages.length ?? 0
    const sectionRecords = getAppStore().getState().job?.sections ?? []
    const droppedCount = sectionRecords.filter(
      (s) =>
        s.macroDecision?.verdict === 'DROP_TO_ONE_LINE' ||
        s.macroDecision?.verdict === 'COMPRESS_TO_BRACKET',
    ).length
    const keptCount = sectionRecords.length - droppedCount
    setStats({
      originalPages,
      abridgedPages: Math.max(1, Math.round(originalPages * (keptCount / Math.max(1, sectionRecords.length)))),
      totalCostUsd: runRecord.cost.billedUsd,
      totalTokens: tokens.promptTokens + tokens.completionTokens,
      sectionsKept: keptCount,
      sectionsDropped: droppedCount,
    })
    setStage('done')
  }, [stage, runRecord, bookRecord, tokens.promptTokens, tokens.completionTokens])

  const modelMapping = useMemo<ModelMapping | undefined>(() => {
    if (runRecord?.modelMapping) return runRecord.modelMapping
    if (provider) return DEFAULT_MODEL_MAPPING[provider]
    return undefined
  }, [provider, runRecord?.modelMapping])

  const runIdForResults = runRecord?.runId ?? resumeRunId

  return (
    <>
      <MobileBlock />
      <AncientLibraryShell statusMessage={statusMessage}>
        <WelcomeOverlay />
        {showResume && resumable ? (
          <ResumePrompt
            summary={resumable}
            onResume={handleResumeAccept}
            onDiscard={handleResumeDiscard}
          />
        ) : null}

        {stage === 'running' ? (
          <PipelineView
            modelMapping={modelMapping}
            onPause={handlePause}
            onResume={handleResumeFromRibbon}
            onCancel={handleCancel}
          />
        ) : stage === 'done' && stats && runIdForResults ? (
          <ResultsScreen
            runId={runIdForResults}
            stats={stats}
            onStartOver={handleStartOver}
            bookTitle={bookRecord?.parsed.title ?? bookRecord?.originalFileName}
          />
        ) : stage === 'errored' ? (
          <ErrorPanel message={errorMessage} onStartOver={handleStartOver} />
        ) : (
          <IntakeScreen onBegin={handleIntakeBegin} />
        )}
      </AncientLibraryShell>
    </>
  )
}

interface ErrorPanelProps {
  message: string
  onStartOver: () => void
}

function ErrorPanel({ message, onStartOver }: ErrorPanelProps) {
  return (
    <section className="error-panel parchment-card" aria-live="assertive">
      <h2 style={{ marginTop: 0 }}>The press has stopped.</h2>
      <p style={{ color: 'var(--shell-ink-soft)', fontStyle: 'italic' }}>
        {message || 'An unknown error occurred.'}
      </p>
      <button
        type="button"
        className="gilt-button gilt-button--primary"
        onClick={onStartOver}
      >
        Start over
      </button>
    </section>
  )
}

export default App
