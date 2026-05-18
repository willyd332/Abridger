import { LLMClient, DEFAULT_MAPPING, type CallEvent } from '@/llm/client'
import { listPrompts, getPrompt } from '@/llm/prompts/loader'
import type { Provider } from '@/llm/types'
import { parseEpub, parsePdf } from '@/parsers'
import type {
  ParseFailureReason,
  ParseResult,
  ParsedBook,
} from '@/parsers/types'

import {
  books as booksStore,
  events as eventsStore,
  inclusion as inclusionStore,
  ontology as ontologyStore,
  runs as runsStore,
  getAppStore,
} from '@/state'
import { buildPromptHashes } from '@/state'
import { defaultSectionPhaseStatus } from '@/state/types'
import type {
  FrontBackMatterHandling,
  ModelMapping,
  RunRecord,
} from '@/state/types'

import { phaseAStructure, type OutlineNode } from '../phaseA-structure'
import type { PhaseEvent } from '../types'

import { buildOntology } from './build'
import { summarizeOntology } from './summarize'

export type StartOntologyRunInput = {
  file: File
  apiKey: string
  provider: Provider
  storeKeyLocally: boolean
  costCeiling: number
  frontBackMatterHandling: FrontBackMatterHandling
  password?: string
  // PDF only — first page that is treated as "page 1" of the book content.
  // Pages before this are preamble: dropped from analysis (Phase A/O/S), then
  // re-attached verbatim at the head of the exported PDF.
  startPage?: number
  __testClient?: LLMClient
}

export type OntologyRunCompletion =
  | { ok: true; runId: string }
  | { ok: false; reason: string; message: string }

export type OntologyRunHandle = {
  runId: string
  client: LLMClient
  cancel: () => void
  pause: () => Promise<void>
  // Raise the spending ceiling. Drains any LLM calls currently parked on
  // the budget gate. Used by the budget-pause modal.
  raiseCeiling: (newCeilingUsd: number) => void
  // Reject all parked LLM calls and let the pipeline absorb the failures
  // (forced-leaf nodes, placeholder summaries). The partial tree is
  // preserved — this is the "stop here, keep what you have" option.
  cancelBudgetWait: () => void
  onEvent: (listener: (event: PhaseEvent) => void) => () => void
  result: Promise<OntologyRunCompletion>
}

export type StartOntologyRunFailureReason =
  | ParseFailureReason
  | 'budget-too-low'
  | 'unknown'

export type StartOntologyRunResult =
  | { ok: true; handle: OntologyRunHandle }
  | { ok: false; reason: StartOntologyRunFailureReason; message: string }

type Listener = (event: PhaseEvent) => void

function createListeners(): {
  add: (l: Listener) => () => void
  emit: (e: PhaseEvent) => void
} {
  let listeners: Listener[] = []
  return {
    add(listener) {
      listeners = [...listeners, listener]
      return () => {
        listeners = listeners.filter((l) => l !== listener)
      }
    },
    emit(event) {
      for (const l of listeners) l(event)
    },
  }
}

function generateId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

async function parseFile(
  file: File,
  password: string | undefined,
  signal?: AbortSignal,
): Promise<ParseResult> {
  const lowerName = file.name.toLowerCase()
  const isEpub = lowerName.endsWith('.epub') || file.type.includes('epub')
  const isPdf = lowerName.endsWith('.pdf') || file.type.includes('pdf')
  if (isEpub) return parseEpub(file, { signal })
  if (isPdf) return parsePdf(file, { password, signal })
  return {
    ok: false,
    reason: 'unsupported-format',
    message: `Unsupported file format: ${file.name}`,
  }
}

async function loadPromptHashes(): Promise<Record<string, string>> {
  const names = listPrompts()
  const prompts = names.map((name) => ({ name, body: getPrompt(name).body }))
  return buildPromptHashes(prompts)
}

function modelMappingForProvider(provider: Provider): ModelMapping {
  const mapping = DEFAULT_MAPPING[provider]
  return { ...mapping }
}

function makeActivityListener(
  hooks: {
    onBudgetExceeded?: (msg: string) => void
  } = {},
): (event: CallEvent) => void {
  let budgetTripped = false
  return (event) => {
    const store = getAppStore().getState()
    if (event.kind === 'call-start') {
      store.pushActivity({
        id: event.requestId,
        phase: event.phase,
        sectionId: event.sectionId,
        role: event.role,
        model: event.model,
        startedAt: event.startedAt,
        status: 'in_flight',
        attempt: 0,
        estimateUsd: event.estimateUsd,
      })
      return
    }
    if (event.kind === 'call-retry') {
      store.patchActivity(event.requestId, {
        status: 'retrying',
        attempt: event.attempt,
      })
      return
    }
    if (event.kind === 'call-end') {
      store.patchActivity(event.requestId, {
        status: 'done',
        endedAt: event.endedAt,
        promptTokens: event.promptTokens,
        completionTokens: event.completionTokens,
        costUsd: event.costUsd,
      })
      store.setTokens({
        promptTokens: store.tokens.promptTokens + event.promptTokens,
        completionTokens: store.tokens.completionTokens + event.completionTokens,
        callsCompleted: store.tokens.callsCompleted + 1,
        callsFailed: store.tokens.callsFailed,
      })
      // Tick the live cost meter so the bottom-right StatsTicker climbs in
      // real time instead of waiting for the run to commit at the end.
      getAppStore().setState((s) => ({
        cost: {
          ...s.cost,
          billedUsd: (s.cost.billedUsd ?? 0) + event.costUsd,
        },
      }))
      return
    }
    if (event.kind === 'call-error') {
      store.patchActivity(event.requestId, {
        status: 'error',
        endedAt: event.endedAt,
        errorMessage: `${event.errorKind}: ${event.message}`,
      })
      store.setTokens({
        ...store.tokens,
        callsFailed: store.tokens.callsFailed + 1,
      })
      if (event.errorKind === 'budget-exceeded' && !budgetTripped) {
        budgetTripped = true
        // eslint-disable-next-line no-console
        console.error('[orchestrator] budget ceiling hit — aborting run', {
          phase: event.phase,
          sectionId: event.sectionId,
        })
        hooks.onBudgetExceeded?.(
          `Spending ceiling reached during phase ${event.phase}. ` +
            'Pipeline aborted to prevent a half-built ontology. ' +
            'Raise the ceiling and start a new run.',
        )
      }
    }
  }
}

function publishJobToStore(run: RunRecord): void {
  const store = getAppStore()
  store.setState({
    currentRunId: run.runId,
    job: { run, book: null, sections: [] },
    cost: run.cost,
  })
}

// Drop pages before startPage and renumber the remaining pages so that
// original page `startPage` becomes logical page 1. Returns a derived
// ParsedBook used throughout Phase A/O/S; the original (unsliced) blob is
// preserved on BookRecord.originalBlob for the export step.
function sliceBookByStartPage(book: ParsedBook, startPage: number): ParsedBook {
  if (startPage <= 1) return book
  const offset = startPage - 1
  const filteredPages = book.pages
    .filter((p) => p.number >= startPage)
    .map((p) => ({
      number: p.number - offset,
      blocks: p.blocks.map((b) => ({ ...b, pageNumber: b.pageNumber - offset })),
    }))
  const rawText = filteredPages
    .flatMap((p) => p.blocks.filter((b) => b.classification === 'body').map((b) => b.text))
    .join('\n')
    .trim()
  return {
    ...book,
    pages: filteredPages,
    rawText,
  }
}

async function runBuildPipeline(args: {
  runId: string
  book: ParsedBook
  client: LLMClient
  emit: (event: PhaseEvent) => void
  signal: AbortSignal
}): Promise<{ ok: true } | { ok: false; reason: string; message: string }> {
  try {
    // Phase A: structure → produces Section[] we'll convert to outline seeds
    const aResult = await phaseAStructure(args.book, args.client, {
      emit: args.emit,
      signal: args.signal,
    })
    const outline: OutlineNode[] = aResult.sections.map((s) => ({
      title: s.title,
      startPage: s.startPage,
      endPage: s.endPage,
    }))

    if (args.signal.aborted) {
      return { ok: false, reason: 'cancelled', message: 'Run cancelled.' }
    }

    // Phase O: build ontology
    const tree = await buildOntology(
      { parsedBook: args.book, outline },
      args.client,
      { emit: args.emit, signal: args.signal },
    )
    await ontologyStore.put({
      runId: args.runId,
      tree,
      storedAt: Date.now(),
    })
    // Initialize inclusion map for leaves (all included)
    const initialInclusion: Record<string, boolean> = {}
    for (const id of tree.leafIdsInOrder) initialInclusion[id] = true
    await inclusionStore.put({
      runId: args.runId,
      inclusion: initialInclusion,
      updatedAt: Date.now(),
    })

    if (args.signal.aborted) {
      return { ok: false, reason: 'cancelled', message: 'Run cancelled.' }
    }

    // Phase S: summarize
    const summarized = await summarizeOntology(tree, args.client, {
      emit: args.emit,
      signal: args.signal,
      bookText: args.book.rawText,
    })
    await ontologyStore.put({
      runId: args.runId,
      tree: summarized.tree,
      storedAt: Date.now(),
    })

    // Publish to live store
    await getAppStore().getState().setOntologyTree(summarized.tree)

    return { ok: true }
  } catch (err) {
    const cancelled =
      args.signal.aborted ||
      (err instanceof DOMException && err.name === 'AbortError') ||
      (err instanceof Error && err.message.includes('cancelled'))
    if (cancelled) return { ok: false, reason: 'cancelled', message: 'Run cancelled.' }
    const message = err instanceof Error ? err.message : String(err)
    args.emit({ kind: 'phase-error', phase: 'orchestrator', error: message })
    return { ok: false, reason: 'errored', message }
  }
}

export async function startOntologyRun(
  input: StartOntologyRunInput,
): Promise<StartOntologyRunResult> {
  const parsed = await parseFile(input.file, input.password)
  if (!parsed.ok) {
    return { ok: false, reason: parsed.reason, message: parsed.message }
  }
  const book = parsed.book

  const runId = generateId('run')
  const bookId = generateId('book')
  const modelMapping = modelMappingForProvider(input.provider)
  const promptHashes = await loadPromptHashes()

  const runRecord = await runsStore.create({
    runId,
    bookId,
    status: 'in_progress',
    phase: 'BUILDING',
    purpose: '', // collected later via Suggest
    provider: input.provider,
    modelMapping,
    promptHashes,
    cost: { ceilingUsd: input.costCeiling, reservedUsd: 0, billedUsd: 0 },
    storeKeyLocally: input.storeKeyLocally,
    frontBackMatterHandling: input.frontBackMatterHandling,
  })

  // PDF preamble support: if startPage > 1, store it on the BookRecord and
  // use a sliced+renumbered ParsedBook for analysis. The originalBlob stays
  // unchanged so the exporter can splice preamble pages back in verbatim.
  const startPage =
    book.format === 'pdf' && typeof input.startPage === 'number' && input.startPage > 1
      ? Math.floor(input.startPage)
      : undefined
  const analyzedBook = startPage ? sliceBookByStartPage(book, startPage) : book

  await booksStore.create({
    bookId,
    runId,
    format: book.format,
    originalFileName: input.file.name,
    originalFileSize: input.file.size,
    parsed: analyzedBook,
    originalBlob: input.file,
    startPage,
  })

  publishJobToStore(runRecord)

  const controller = new AbortController()
  const listeners = createListeners()
  const client =
    input.__testClient ??
    new LLMClient({
      provider: input.provider,
      apiKey: input.apiKey,
      ceilingUsd: input.costCeiling,
      onCallEvent: makeActivityListener(),
    })

  // Install a pause handler on the cost meter. When the ceiling would be
  // exceeded, the meter queues the call instead of failing. We surface that
  // state to the UI via a `budget-pause` PhaseEvent so the user can either
  // raise the ceiling (handle.raiseCeiling) or stop (handle.cancelBudgetWait).
  client.getCostMeter().setPauseHandler((paused, snapshot) => {
    // eslint-disable-next-line no-console
    console.log('[orchestrator] budget pause-state change', { paused, snapshot })
    listeners.emit({
      kind: 'budget-pause',
      paused,
      reservedUsd: snapshot.reservedUsd,
      billedUsd: snapshot.billedUsd,
      ceilingUsd: snapshot.ceilingUsd,
      pendingCount: client.getCostMeter().pendingCount(),
    })
  })

  const result: Promise<OntologyRunCompletion> = (async () => {
    const outcome = await runBuildPipeline({
      runId,
      book: analyzedBook,
      client,
      emit: (event) => listeners.emit(event),
      signal: controller.signal,
    })
    const snapshot = client.getCostMeter().snapshot()
    if (outcome.ok) {
      await runsStore.update(runId, {
        status: 'in_progress',
        phase: 'CURATING',
        cost: { ...snapshot },
      })
      return { ok: true as const, runId }
    }
    if (outcome.reason === 'cancelled') {
      await runsStore.update(runId, {
        status: 'cancelled',
        cost: { ...snapshot },
      })
    } else {
      await runsStore.update(runId, {
        status: 'errored',
        cost: { ...snapshot },
      })
      await eventsStore.append({
        runId,
        timestamp: Date.now(),
        event: { kind: 'phase-error', phase: 'orchestrator', error: outcome.message },
      })
    }
    return outcome
  })()

  const handle: OntologyRunHandle = {
    runId,
    client,
    cancel: () => controller.abort(),
    pause: async () => {
      await runsStore.update(runId, { status: 'paused' })
    },
    raiseCeiling: (newCeilingUsd: number) => {
      // eslint-disable-next-line no-console
      console.log('[orchestrator] raising ceiling', {
        from: client.getCostMeter().getCeiling(),
        to: newCeilingUsd,
      })
      client.getCostMeter().setCeiling(newCeilingUsd)
      // Persist the new ceiling on the run record so a later resume sees it.
      void runsStore.update(runId, {
        cost: {
          ...client.getCostMeter().snapshot(),
          ceilingUsd: newCeilingUsd,
        },
      })
    },
    cancelBudgetWait: () => {
      // eslint-disable-next-line no-console
      console.warn('[orchestrator] user chose Stop — rejecting parked calls')
      client.getCostMeter().cancelAllPending()
    },
    onEvent: (listener) => listeners.add(listener),
    result,
  }
  return { ok: true, handle }
}

// Suppress unused warning for defaultSectionPhaseStatus (re-exported by orchestrator.ts);
// it's not used by this new entry point, but kept exported here for parity.
export { defaultSectionPhaseStatus }
