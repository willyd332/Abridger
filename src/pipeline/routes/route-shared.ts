import type { LLMClient } from '@/llm/client'
import type { ParsedBook } from '@/parsers/types'

import {
  phaseAStructure,
  phaseA5Canonical,
  phaseBSummarize,
  phaseB5Spine,
  phaseC1Macro,
  phaseC15Sanity,
  phaseC2Micro,
} from '@/pipeline'
import { reconstructEpub, reconstructPdf } from '@/pipeline'
import { buildLedger } from '@/pipeline/phaseD-reconstruct/ledger'

import {
  brackets as bracketsStore,
  events as eventsStore,
  outputs as outputsStore,
  runs as runsStore,
  sections as sectionsStore,
  spine as spineStore,
} from '@/state'
import { getAppStore, inspectMemoryPressure } from '@/state'
import { defaultSectionPhaseStatus } from '@/state/types'
import type {
  BookContext,
  CanonicalPassage,
  Emit,
  MacroDecision,
  MicroDecision,
  NarrativeSpine,
  PhaseEvent,
  Section,
} from '@/pipeline/types'
import type { PhaseName, SectionPhaseStatus } from '@/state/types'

export type RouteContext = {
  runId: string
  book: ParsedBook
  originalBlob: Blob
  purpose: string
  client: LLMClient
  emit?: Emit
  signal?: AbortSignal
}

export type RouteOutput = {
  abridgedBlob: Blob
  ledgerBlob: Blob
  abridgedMimeType: string
  ledgerMimeType: 'text/markdown'
  stats: Record<string, unknown>
}

export const MEMORY_PRESSURE_THRESHOLD = 0.85

export function makeEmitter(ctx: RouteContext): Emit {
  return (event: PhaseEvent) => {
    void eventsStore.append({
      runId: ctx.runId,
      timestamp: Date.now(),
      event,
    })
    ctx.emit?.(event)
  }
}

export async function recordPhase(
  ctx: RouteContext,
  phaseLabel: string,
): Promise<void> {
  await runsStore.update(ctx.runId, { phase: phaseLabel })
  const job = getAppStore().getState().job
  if (job) {
    const refreshed = await runsStore.get(ctx.runId)
    if (refreshed) {
      getAppStore().setState({
        job: { ...job, run: refreshed },
        cost: refreshed.cost,
      })
    }
  }
}

export async function persistInitialSections(
  ctx: RouteContext,
  sections: Section[],
): Promise<void> {
  for (const section of sections) {
    await sectionsStore.create({
      runId: ctx.runId,
      sectionId: section.id,
      order: section.order,
      section,
      phaseStatus: defaultSectionPhaseStatus(),
    })
  }
  await syncSectionsToStore(ctx)
}

export async function patchSectionPhase(
  ctx: RouteContext,
  sectionId: string,
  phase: PhaseName,
  patch: Partial<SectionPhaseStatus[PhaseName]>,
): Promise<void> {
  const current = await sectionsStore.get(ctx.runId, sectionId)
  if (!current) return
  const next: SectionPhaseStatus = {
    ...current.phaseStatus,
    [phase]: { ...current.phaseStatus[phase], ...patch },
  }
  await sectionsStore.update(ctx.runId, sectionId, { phaseStatus: next })
}

export async function persistUpdatedSections(
  ctx: RouteContext,
  sections: Section[],
  phase: PhaseName,
): Promise<void> {
  for (const section of sections) {
    const current = await sectionsStore.get(ctx.runId, section.id)
    if (!current) continue
    const phaseStatus: SectionPhaseStatus = {
      ...current.phaseStatus,
      [phase]: {
        ...current.phaseStatus[phase],
        status: 'done',
        completedAt: Date.now(),
      },
    }
    await sectionsStore.update(ctx.runId, section.id, {
      section,
      phaseStatus,
    })
  }
  await syncSectionsToStore(ctx)
}

export async function persistMacroDecisions(
  ctx: RouteContext,
  decisions: MacroDecision[],
  phase: PhaseName,
): Promise<void> {
  for (const decision of decisions) {
    const current = await sectionsStore.get(ctx.runId, decision.sectionId)
    if (!current) continue
    const phaseStatus: SectionPhaseStatus = {
      ...current.phaseStatus,
      [phase]: {
        ...current.phaseStatus[phase],
        status: 'done',
        completedAt: Date.now(),
      },
    }
    await sectionsStore.update(ctx.runId, decision.sectionId, {
      macroDecision: decision,
      phaseStatus,
    })
  }
  await syncSectionsToStore(ctx)
}

export async function persistMicroDecisions(
  ctx: RouteContext,
  decisions: MicroDecision[],
): Promise<void> {
  for (const decision of decisions) {
    const current = await sectionsStore.get(ctx.runId, decision.sectionId)
    if (!current) continue
    const phaseStatus: SectionPhaseStatus = {
      ...current.phaseStatus,
      C2: {
        ...current.phaseStatus.C2,
        status: 'done',
        completedAt: Date.now(),
      },
    }
    await sectionsStore.update(ctx.runId, decision.sectionId, {
      microDecision: decision,
      phaseStatus,
    })
  }
  await syncSectionsToStore(ctx)
}

export async function persistSpineAndCanonical(
  ctx: RouteContext,
  spine: NarrativeSpine,
  canonicalPassages: CanonicalPassage[],
): Promise<void> {
  await spineStore.create({
    runId: ctx.runId,
    spine,
    canonicalPassages,
  })
}

export async function persistBrackets(
  ctx: RouteContext,
  bracketTexts: Array<{ sectionId: string; deletionIndex: number; bracketText: string }>,
  model: string,
): Promise<void> {
  for (const b of bracketTexts) {
    await bracketsStore.create({
      runId: ctx.runId,
      sectionId: b.sectionId,
      deletionIndex: b.deletionIndex,
      bracketText: b.bracketText,
      producedAt: Date.now(),
      model,
    })
  }
}

export async function syncSectionsToStore(ctx: RouteContext): Promise<void> {
  const store = getAppStore()
  const current = store.getState().job
  if (!current || current.run.runId !== ctx.runId) return
  const sectionList = await sectionsStore.listByRun(ctx.runId)
  store.setState({ job: { ...current, sections: sectionList } })
}

export async function syncRunToStore(ctx: RouteContext): Promise<void> {
  const store = getAppStore()
  const refreshed = await runsStore.get(ctx.runId)
  if (!refreshed) return
  const current = store.getState().job
  if (current && current.run.runId === ctx.runId) {
    store.setState({
      job: { ...current, run: refreshed },
      cost: refreshed.cost,
    })
  }
}

export async function checkAbort(ctx: RouteContext): Promise<void> {
  if (ctx.signal?.aborted) {
    await runsStore.update(ctx.runId, { status: 'cancelled' })
    await syncRunToStore(ctx)
    throw new DOMException('Run cancelled', 'AbortError')
  }
}

export function maybeWarnMemoryPressure(emit: Emit): void {
  const snapshot = inspectMemoryPressure()
  if (!snapshot.available || snapshot.pressureRatio === undefined) return
  if (snapshot.pressureRatio > MEMORY_PRESSURE_THRESHOLD) {
    emit({
      kind: 'phase-error',
      phase: 'memory',
      error: `Memory pressure high (${(snapshot.pressureRatio * 100).toFixed(0)}%); spilling working state.`,
    })
  }
}

export async function commitCostFromMeter(ctx: RouteContext): Promise<void> {
  const snapshot = ctx.client.getCostMeter().snapshot()
  await runsStore.update(ctx.runId, { cost: { ...snapshot } })
  await syncRunToStore(ctx)
}

export function buildBookContext(
  purpose: string,
  sections: Section[],
  spine: NarrativeSpine,
  canonicalPassages: CanonicalPassage[],
): BookContext {
  return {
    purpose,
    spine,
    canonicalPassages,
    allSectionSummaries: sections.map((s) => ({
      id: s.id,
      title: s.title,
      order: s.order,
      summary: s.summary,
      signals: s.signals,
    })),
  }
}

export type StandardPipelineState = {
  sections: Section[]
  canonicalPassages: CanonicalPassage[]
  spine: NarrativeSpine
  ctx: BookContext
  macroDecisions: MacroDecision[]
  microDecisions: MicroDecision[]
}

type StandardPhaseAOptions = {
  windowPages?: number
  bypassPhaseA?: boolean
  preBuiltSections?: Section[]
}

export async function runPhaseA(
  ctx: RouteContext,
  emit: Emit,
  opts: StandardPhaseAOptions = {},
): Promise<Section[]> {
  await checkAbort(ctx)
  await recordPhase(ctx, 'A')
  if (opts.bypassPhaseA && opts.preBuiltSections) {
    await persistInitialSections(ctx, opts.preBuiltSections)
    return opts.preBuiltSections
  }
  const result = await phaseAStructure(ctx.book, ctx.client, {
    emit,
    signal: ctx.signal,
    windowPages: opts.windowPages,
  })
  await persistInitialSections(ctx, result.sections)
  await commitCostFromMeter(ctx)
  return result.sections
}

export async function runPhaseA5(
  ctx: RouteContext,
  emit: Emit,
): Promise<CanonicalPassage[]> {
  await checkAbort(ctx)
  await recordPhase(ctx, 'A5')
  const passages = await phaseA5Canonical(ctx.book, ctx.client, {
    emit,
    signal: ctx.signal,
  })
  await commitCostFromMeter(ctx)
  return passages
}

export async function runPhaseB(
  ctx: RouteContext,
  emit: Emit,
  sections: Section[],
): Promise<Section[]> {
  await checkAbort(ctx)
  await recordPhase(ctx, 'B')
  const result = await phaseBSummarize(sections, ctx.purpose, ctx.client, {
    emit,
    signal: ctx.signal,
    onSectionDone: () => maybeWarnMemoryPressure(emit),
  })
  await persistUpdatedSections(ctx, result, 'B')
  await commitCostFromMeter(ctx)
  return result
}

export async function runPhaseB5(
  ctx: RouteContext,
  emit: Emit,
  sections: Section[],
  canonicalPassages: CanonicalPassage[],
): Promise<NarrativeSpine> {
  await checkAbort(ctx)
  await recordPhase(ctx, 'B5')
  const spine = await phaseB5Spine(sections, ctx.purpose, canonicalPassages, ctx.client, {
    emit,
    signal: ctx.signal,
  })
  await persistSpineAndCanonical(ctx, spine, canonicalPassages)
  await commitCostFromMeter(ctx)
  return spine
}

export async function runPhaseC1(
  ctx: RouteContext,
  emit: Emit,
  sections: Section[],
  bookCtx: BookContext,
): Promise<MacroDecision[]> {
  await checkAbort(ctx)
  await recordPhase(ctx, 'C1')
  const decisions = await phaseC1Macro(sections, bookCtx, ctx.client, {
    emit,
    signal: ctx.signal,
  })
  await persistMacroDecisions(ctx, decisions, 'C1')
  await commitCostFromMeter(ctx)
  return decisions
}

export async function runPhaseC15(
  ctx: RouteContext,
  emit: Emit,
  sections: Section[],
  decisions: MacroDecision[],
  bookCtx: BookContext,
): Promise<MacroDecision[]> {
  await checkAbort(ctx)
  await recordPhase(ctx, 'C15')
  const updated = await phaseC15Sanity(sections, decisions, bookCtx, ctx.client, {
    emit,
    signal: ctx.signal,
  })
  await persistMacroDecisions(ctx, updated, 'C15')
  await commitCostFromMeter(ctx)
  return updated
}

export async function runPhaseC2(
  ctx: RouteContext,
  emit: Emit,
  sections: Section[],
  decisions: MacroDecision[],
  bookCtx: BookContext,
): Promise<MicroDecision[]> {
  await checkAbort(ctx)
  await recordPhase(ctx, 'C2')
  const micros = await phaseC2Micro(sections, decisions, bookCtx, ctx.client, {
    emit,
    signal: ctx.signal,
  })
  await persistMicroDecisions(ctx, micros)
  await commitCostFromMeter(ctx)
  return micros
}

export type ReconstructResult = {
  abridgedBlob: Blob
  bracketTexts: Array<{ sectionId: string; deletionIndex: number; bracketText: string }>
  abridgedMimeType: string
  stats: Record<string, unknown>
}

export async function runReconstruction(
  ctx: RouteContext,
  emit: Emit,
  state: StandardPipelineState,
): Promise<ReconstructResult> {
  await checkAbort(ctx)
  await recordPhase(ctx, 'D')

  if (ctx.book.format === 'epub') {
    const result = await reconstructEpub(
      {
        originalBlob: ctx.originalBlob,
        parsedBook: ctx.book,
        sections: state.sections,
        macroDecisions: state.macroDecisions,
        microDecisions: state.microDecisions,
        ctx: state.ctx,
        client: ctx.client,
      },
      { emit, signal: ctx.signal },
    )
    return {
      abridgedBlob: result.abridgedBlob,
      bracketTexts: result.bracketTexts,
      abridgedMimeType: 'application/epub+zip',
      stats: result.stats as unknown as Record<string, unknown>,
    }
  }

  const result = await reconstructPdf(
    {
      parsedBook: ctx.book,
      sections: state.sections,
      macroDecisions: state.macroDecisions,
      microDecisions: state.microDecisions,
      ctx: state.ctx,
      client: ctx.client,
    },
    { emit, signal: ctx.signal },
  )
  return {
    abridgedBlob: result.abridgedBlob,
    bracketTexts: result.bracketTexts,
    abridgedMimeType: 'application/pdf',
    stats: result.stats as unknown as Record<string, unknown>,
  }
}

export async function finalizeOutputs(
  ctx: RouteContext,
  recon: ReconstructResult,
  state: StandardPipelineState,
  modelMapping: Record<string, string>,
  promptHashes: Record<string, string>,
  originalFileName: string,
  startedAt: number,
): Promise<RouteOutput> {
  await persistBrackets(ctx, recon.bracketTexts, modelMapping.smart ?? 'unknown')

  const run = await runsStore.get(ctx.runId)
  const totalCostUsd = run?.cost.billedUsd ?? 0

  const ledger = buildLedger({
    parsedBook: ctx.book,
    sections: state.sections,
    macroDecisions: state.macroDecisions,
    microDecisions: state.microDecisions,
    spine: state.spine,
    canonicalPassages: state.canonicalPassages,
    brackets: recon.bracketTexts,
    runId: ctx.runId,
    startedAt,
    finishedAt: Date.now(),
    modelMapping,
    promptHashes,
    totalCostUsd,
    purpose: ctx.purpose,
    originalFileName,
  })

  const abridgedKind = ctx.book.format === 'pdf' ? 'abridged-pdf' : 'abridged-epub'
  await outputsStore.create({
    runId: ctx.runId,
    kind: abridgedKind,
    mimeType: recon.abridgedMimeType,
    blob: recon.abridgedBlob,
    producedAt: Date.now(),
  })
  await outputsStore.create({
    runId: ctx.runId,
    kind: 'ledger-md',
    mimeType: 'text/markdown',
    blob: ledger.blob,
    producedAt: Date.now(),
  })

  return {
    abridgedBlob: recon.abridgedBlob,
    ledgerBlob: ledger.blob,
    abridgedMimeType: recon.abridgedMimeType,
    ledgerMimeType: 'text/markdown',
    stats: { ...recon.stats, ...ledger.stats },
  }
}
