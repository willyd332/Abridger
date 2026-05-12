import { LLMClient, DEFAULT_MAPPING } from '@/llm/client'
import { listPrompts, getPrompt } from '@/llm/prompts/loader'
import type { Provider } from '@/llm/types'

import { parseEpub, parsePdf } from '@/parsers'
import type { ParseFailureReason, ParseResult, ParsedBook } from '@/parsers/types'

import { estimateCost } from './cost-estimate'
import {
  detectRoute,
  executeLongBookRoute,
  executeNoChapterBookRoute,
  executeNormalBookRoute,
  executeShortBookRoute,
} from './routes'

import {
  books as booksStore,
  events as eventsStore,
  outputs as outputsStore,
  runs as runsStore,
  sections as sectionsStore,
  spine as spineStore,
} from '@/state'
import {
  buildPromptHashes,
  findResumableRun,
  reapOrphans,
  verifyPinningAgainst,
} from '@/state'
import { getAppStore } from '@/state'
import { defaultSectionPhaseStatus } from '@/state/types'
import type {
  FrontBackMatterHandling,
  ModelMapping,
  RouteName,
  RunRecord,
} from '@/state/types'
import type { PhaseEvent } from '@/pipeline/types'

export type StartRunInput = {
  file: File
  apiKey: string
  provider: Provider
  purpose: string
  storeKeyLocally: boolean
  costCeiling: number
  frontBackMatterHandling: FrontBackMatterHandling
  password?: string
  __testClient?: LLMClient
}

export type RunHandle = {
  runId: string
  cancel: () => void
  pause: () => Promise<void>
  onEvent: (listener: (event: PhaseEvent) => void) => () => void
  result: Promise<RunCompletion>
}

export type RunCompletion =
  | { ok: true; outputs: { abridged: Blob; ledger: Blob; abridgedMimeType: string } }
  | { ok: false; reason: string; message: string }

export type StartRunFailureReason =
  | ParseFailureReason
  | 'budget-too-low'
  | 'unsupported'
  | 'invalid-key'
  | 'pinning-mismatch'
  | 'unknown'

export type StartRunResult =
  | { ok: true; handle: RunHandle }
  | { ok: false; reason: StartRunFailureReason; message: string; mismatches?: Array<{ path: string; expected: string; actual: string }> }

type Listener = (event: PhaseEvent) => void

type Listeners = {
  add(listener: Listener): () => void
  emit(event: PhaseEvent): void
}

function createListeners(): Listeners {
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

function publishJobToStore(run: RunRecord): void {
  const store = getAppStore()
  store.setState({
    currentRunId: run.runId,
    job: { run, book: null, sections: [] },
    cost: run.cost,
  })
}

async function executeRoute(args: {
  runId: string
  route: RouteName
  book: ParsedBook
  originalBlob: Blob
  purpose: string
  client: LLMClient
  emit: (event: PhaseEvent) => void
  signal: AbortSignal
  modelMapping: ModelMapping
  promptHashes: Record<string, string>
  originalFileName: string
  startedAt: number
}) {
  const ctx = {
    runId: args.runId,
    book: args.book,
    originalBlob: args.originalBlob,
    purpose: args.purpose,
    client: args.client,
    emit: args.emit,
    signal: args.signal,
  }
  const routeOpts = {
    modelMapping: args.modelMapping,
    promptHashes: args.promptHashes,
    originalFileName: args.originalFileName,
    startedAt: args.startedAt,
  }
  if (args.route === 'short-book') return executeShortBookRoute(ctx, routeOpts)
  if (args.route === 'long-book') return executeLongBookRoute(ctx, routeOpts)
  if (args.route === 'no-chapter-book') return executeNoChapterBookRoute(ctx, routeOpts)
  return executeNormalBookRoute(ctx, routeOpts)
}

async function buildClient(input: StartRunInput): Promise<LLMClient> {
  if (input.__testClient) return input.__testClient
  return new LLMClient({
    provider: input.provider,
    apiKey: input.apiKey,
    ceilingUsd: input.costCeiling,
  })
}

async function runWorkflow(args: {
  runId: string
  route: RouteName
  book: ParsedBook
  originalBlob: Blob
  purpose: string
  client: LLMClient
  listeners: Listeners
  signal: AbortSignal
  modelMapping: ModelMapping
  promptHashes: Record<string, string>
  originalFileName: string
  startedAt: number
}): Promise<RunCompletion> {
  const handleEvent = (event: PhaseEvent): void => {
    args.listeners.emit(event)
  }

  try {
    const out = await executeRoute({
      runId: args.runId,
      route: args.route,
      book: args.book,
      originalBlob: args.originalBlob,
      purpose: args.purpose,
      client: args.client,
      emit: handleEvent,
      signal: args.signal,
      modelMapping: args.modelMapping,
      promptHashes: args.promptHashes,
      originalFileName: args.originalFileName,
      startedAt: args.startedAt,
    })

    const snapshot = args.client.getCostMeter().snapshot()
    await runsStore.update(args.runId, {
      status: 'done',
      phase: 'DONE',
      cost: { ...snapshot },
    })

    return {
      ok: true,
      outputs: {
        abridged: out.abridgedBlob,
        ledger: out.ledgerBlob,
        abridgedMimeType: out.abridgedMimeType,
      },
    }
  } catch (err) {
    const cancelled =
      args.signal.aborted ||
      (err instanceof DOMException && err.name === 'AbortError') ||
      (err instanceof Error && err.message.includes('cancelled'))
    const snapshot = args.client.getCostMeter().snapshot()
    if (cancelled) {
      await runsStore.update(args.runId, {
        status: 'cancelled',
        cost: { ...snapshot },
      })
      return { ok: false, reason: 'cancelled', message: 'Run cancelled.' }
    }
    const message = err instanceof Error ? err.message : String(err)
    await runsStore.update(args.runId, {
      status: 'errored',
      cost: { ...snapshot },
    })
    args.listeners.emit({ kind: 'phase-error', phase: 'orchestrator', error: message })
    await eventsStore.append({
      runId: args.runId,
      timestamp: Date.now(),
      event: { kind: 'phase-error', phase: 'orchestrator', error: message },
    })
    return { ok: false, reason: 'errored', message }
  }
}

export async function startRun(input: StartRunInput): Promise<StartRunResult> {
  const parsed = await parseFile(input.file, input.password)
  if (!parsed.ok) {
    return { ok: false, reason: parsed.reason, message: parsed.message }
  }
  const book = parsed.book

  const detection = detectRoute(book)
  const route = detection.route
  const modelMapping = modelMappingForProvider(input.provider)
  const estimate = estimateCost(book, input.provider, modelMapping, route)

  if (estimate.minUsd > input.costCeiling) {
    return {
      ok: false,
      reason: 'budget-too-low',
      message: `Estimated minimum cost $${estimate.minUsd.toFixed(2)} exceeds ceiling $${input.costCeiling.toFixed(2)}.`,
    }
  }

  const runId = generateId('run')
  const bookId = generateId('book')
  const promptHashes = await loadPromptHashes()

  const runRecord = await runsStore.create({
    runId,
    bookId,
    status: 'in_progress',
    phase: 'INTAKE',
    route,
    purpose: input.purpose,
    provider: input.provider,
    modelMapping,
    promptHashes,
    cost: { ceilingUsd: input.costCeiling, reservedUsd: 0, billedUsd: 0 },
    storeKeyLocally: input.storeKeyLocally,
    frontBackMatterHandling: input.frontBackMatterHandling,
  })

  await booksStore.create({
    bookId,
    runId,
    format: book.format,
    originalFileName: input.file.name,
    originalFileSize: input.file.size,
    parsed: book,
    originalBlob: input.file,
  })

  publishJobToStore(runRecord)

  const controller = new AbortController()
  const listeners = createListeners()
  const client = await buildClient(input)
  const startedAt = Date.now()

  const result = runWorkflow({
    runId,
    route,
    book,
    originalBlob: input.file,
    purpose: input.purpose,
    client,
    listeners,
    signal: controller.signal,
    modelMapping,
    promptHashes,
    originalFileName: input.file.name,
    startedAt,
  })

  const handle: RunHandle = {
    runId,
    cancel: () => controller.abort(),
    pause: async () => {
      await runsStore.update(runId, { status: 'paused' })
    },
    onEvent: (listener) => listeners.add(listener),
    result,
  }

  return { ok: true, handle }
}

export async function resumeRun(runId: string): Promise<StartRunResult> {
  const run = await runsStore.get(runId)
  if (!run) {
    return { ok: false, reason: 'unknown', message: `Run ${runId} not found.` }
  }
  const book = await booksStore.getByRun(runId)
  if (!book) {
    return { ok: false, reason: 'unknown', message: `Book for run ${runId} not found.` }
  }

  await reapOrphans(runId)

  const currentPromptHashes = await loadPromptHashes()
  const currentMapping = modelMappingForProvider(run.provider)
  const pinning = verifyPinningAgainst(run, currentMapping, currentPromptHashes)
  if (!pinning.ok) {
    return {
      ok: false,
      reason: 'pinning-mismatch',
      message: 'Model/prompt pinning mismatch on resume.',
      mismatches: pinning.mismatches,
    }
  }

  await runsStore.update(runId, { status: 'in_progress' })

  publishJobToStore(run)

  const controller = new AbortController()
  const listeners = createListeners()
  const apiKey = '' // resumed runs need fresh API key; caller must provide via different path.
  void apiKey
  const client = new LLMClient({
    provider: run.provider,
    apiKey: '',
    ceilingUsd: run.cost.ceilingUsd,
  })
  const startedAt = Date.now()
  const route = run.route ?? 'normal-book'

  const result = runWorkflow({
    runId,
    route,
    book: book.parsed,
    originalBlob: book.originalBlob,
    purpose: run.purpose,
    client,
    listeners,
    signal: controller.signal,
    modelMapping: run.modelMapping,
    promptHashes: run.promptHashes,
    originalFileName: book.originalFileName,
    startedAt,
  })

  return {
    ok: true,
    handle: {
      runId,
      cancel: () => controller.abort(),
      pause: async () => {
        await runsStore.update(runId, { status: 'paused' })
      },
      onEvent: (listener) => listeners.add(listener),
      result,
    },
  }
}

export type ResumableSummary = {
  runId: string
  status: RunRecord['status']
  phase: string
  purpose: string
  costBilledUsd: number
  costCeilingUsd: number
  updatedAt: number
}

export async function findResumable(): Promise<ResumableSummary | null> {
  const match = await findResumableRun()
  if (!match) return null
  return {
    runId: match.runId,
    status: match.summary.status,
    phase: match.summary.phase,
    purpose: match.summary.purpose,
    costBilledUsd: match.summary.costBilledUsd,
    costCeilingUsd: match.summary.costCeilingUsd,
    updatedAt: match.summary.updatedAt,
  }
}

export { defaultSectionPhaseStatus }
export { sectionsStore as sections, outputsStore as outputs, spineStore as spine }
