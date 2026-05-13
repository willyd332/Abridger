import { z } from 'zod'

import { DEFAULT_LLM_CONCURRENCY, mapWithLimit } from '@/lib/concurrency'
import { LLMClient } from '@/llm/client'
import { getPrompt } from '@/llm/prompts/loader'

import type {
  BookContext,
  BracketLengthHint,
  CanonicalPassage,
  Emit,
  MacroDecision,
  MacroVerdict,
  NarrativeSpine,
  Section,
} from './types'

const PHASE_NAME = 'C1-macro'
const DEFAULT_CHUNK_THRESHOLD = 40
const DEFAULT_CHUNK_SIZE = 20
const DEFAULT_CHUNK_OVERLAP = 4

const VERDICT_VALUES = [
  'KEEP_FULL',
  'KEEP_PARTIAL',
  'COMPRESS_TO_BRACKET',
  'DROP_TO_ONE_LINE',
] as const satisfies readonly MacroVerdict[]

const BRACKET_LENGTH_VALUES = ['one-line', 'short', 'medium', 'long'] as const satisfies readonly BracketLengthHint[]

const decisionSchema = z.object({
  sectionId: z.string().min(1),
  verdict: z.enum(VERDICT_VALUES),
  rationale: z.string().min(1),
  forwardDependencies: z.array(z.string().min(1)),
  backwardDependencies: z.array(z.string().min(1)),
  bracketLengthHint: z.enum(BRACKET_LENGTH_VALUES).optional(),
  confidence: z.number().min(0).max(1),
})

const responseSchema = z.object({
  decisions: z.array(decisionSchema),
})

export type PhaseC1Options = {
  emit?: Emit
  signal?: AbortSignal
  chunkThreshold?: number
  chunkSize?: number
  chunkOverlap?: number
}

function spinePayload(spine: NarrativeSpine): string {
  const motifs = spine.recurringMotifs.length > 0 ? spine.recurringMotifs.join(', ') : '(none)'
  const anchors =
    spine.voiceAnchors.length > 0
      ? spine.voiceAnchors.map((a, i) => `Anchor ${i + 1}: "${a}"`).join('\n')
      : '(none)'
  return [
    `Central argument: ${spine.centralArgument}`,
    `Narrative shape: ${spine.narrativeShape}`,
    `Recurring motifs: ${motifs}`,
    `Voice anchors:\n${anchors}`,
  ].join('\n')
}

function canonicalPayload(passages: CanonicalPassage[]): string {
  if (passages.length === 0) return '(none provided)'
  return passages
    .map((p, i) => `${i + 1}. ${p.description} (ref: ${p.pageOrSectionRef}${p.validated ? ', validated' : ''})`)
    .join('\n')
}

function sectionSummaryLine(section: Section): string {
  const signals = section.signals
    ? ` [function=${section.signals.narrativeFunction}, isCore=${section.signals.isCore}, famous=${section.signals.hasFamousArgument}, density=${section.signals.density}]`
    : ''
  const summary = section.summary ?? '[no summary]'
  return `- id="${section.id}" order=${section.order} title="${section.title}"${signals}\n  ${summary}`
}

function sectionTitleLine(section: Section): string {
  return `- id="${section.id}" order=${section.order} title="${section.title}"`
}

function fallbackDecision(section: Section, reason: string): MacroDecision {
  return {
    sectionId: section.id,
    verdict: 'KEEP_FULL',
    rationale: `[fallback] ${reason}`,
    forwardDependencies: [],
    backwardDependencies: [],
    confidence: 0,
  }
}

type WindowSpec = {
  windowIndex: number
  windowCount: number
  inScopeIds: string[]
  inScope: Section[]
  contextOnly: Section[]
}

function buildWindows(
  sections: Section[],
  chunkSize: number,
  chunkOverlap: number,
): WindowSpec[] {
  const windows: WindowSpec[] = []
  const step = Math.max(1, chunkSize - chunkOverlap)
  let start = 0
  while (start < sections.length) {
    const end = Math.min(sections.length, start + chunkSize)
    const inScope = sections.slice(start, end)
    const inScopeIds = inScope.map((s) => s.id)
    const contextOnly = sections.filter((s) => !inScopeIds.includes(s.id))
    windows.push({
      windowIndex: windows.length,
      windowCount: 0,
      inScopeIds,
      inScope,
      contextOnly,
    })
    if (end >= sections.length) break
    start += step
  }
  return windows.map((w) => ({ ...w, windowCount: windows.length }))
}

async function callMacro(
  client: LLMClient,
  ctx: Pick<BookContext, 'purpose' | 'spine' | 'canonicalPassages'>,
  inScope: Section[],
  contextOnly: Section[],
  windowSpec: { windowIndex: number; windowCount: number } | null,
  strictRetry: boolean,
  requestId: string,
  opts: { signal?: AbortSignal },
): Promise<MacroDecision[] | null> {
  const prompt = getPrompt('macro-filter')
  const inScopeIds = inScope.map((s) => s.id)
  const sectionsBlock = inScope.map(sectionSummaryLine).join('\n\n')
  const contextBlock =
    windowSpec && contextOnly.length > 0
      ? `\n\nContext-only sections (do NOT issue verdicts for these):\n${contextOnly.map(sectionTitleLine).join('\n')}`
      : ''
  const windowHeader = windowSpec
    ? `Window ${windowSpec.windowIndex + 1} of ${windowSpec.windowCount}. In-scope section IDs: ${JSON.stringify(inScopeIds)}. Return decisions ONLY for these IDs.\n\n`
    : ''
  const strictNote = strictRetry
    ? '\n\nSTRICT REQUIREMENT: return strictly valid JSON only, no prose, no markdown fences, no commentary.'
    : ''

  const user = [
    `${windowHeader}Reading purpose: ${ctx.purpose}`,
    '',
    'Narrative spine:',
    spinePayload(ctx.spine),
    '',
    'Canonical passages:',
    canonicalPayload(ctx.canonicalPassages),
    '',
    `Section summaries (in scope${windowSpec ? ' — window' : ''}, in book order):`,
    sectionsBlock,
    contextBlock,
    strictNote,
    '',
    'Return JSON: {"decisions":[{"sectionId":"…","verdict":"…","rationale":"…","forwardDependencies":[…],"backwardDependencies":[…],"bracketLengthHint":"…","confidence":0..1}]}',
  ]
    .filter((line) => line !== '')
    .join('\n')

  const result = await client.call({
    role: prompt.meta.role,
    temperature: prompt.meta.temperature,
    responseFormat: prompt.meta.responseFormat === 'json' ? { jsonSchema: {} } : 'text',
    system: prompt.body,
    user,
    signal: opts.signal,
    metadata: { phase: PHASE_NAME, requestId },
  })
  if (!result.ok) return null
  try {
    const parsed = responseSchema.parse(JSON.parse(result.data))
    return parsed.decisions
  } catch {
    return null
  }
}

async function callMacroWithRetry(
  client: LLMClient,
  ctx: Pick<BookContext, 'purpose' | 'spine' | 'canonicalPassages'>,
  inScope: Section[],
  contextOnly: Section[],
  windowSpec: { windowIndex: number; windowCount: number } | null,
  baseRequestId: string,
  opts: { signal?: AbortSignal; emit?: Emit },
): Promise<MacroDecision[]> {
  const initial = await callMacro(client, ctx, inScope, contextOnly, windowSpec, false, baseRequestId, opts)
  if (initial !== null) return initial
  const retry = await callMacro(
    client,
    ctx,
    inScope,
    contextOnly,
    windowSpec,
    true,
    `${baseRequestId}-strict`,
    opts,
  )
  if (retry !== null) return retry
  opts.emit?.({
    kind: 'phase-error',
    phase: PHASE_NAME,
    error: `Macro call failed after retry (${baseRequestId}); falling back to KEEP_FULL.`,
  })
  return inScope.map((s) => fallbackDecision(s, 'macro call failed after strict retry'))
}

function pickBetterDecision(a: MacroDecision, b: MacroDecision): MacroDecision {
  if (a.confidence !== b.confidence) return a.confidence > b.confidence ? a : b
  return b
}

async function reconcile(
  client: LLMClient,
  ctx: Pick<BookContext, 'purpose' | 'spine' | 'canonicalPassages'>,
  sections: Section[],
  draftByWindow: Array<{ windowIndex: number; decisions: MacroDecision[] }>,
  opts: { signal?: AbortSignal; emit?: Emit },
): Promise<MacroDecision[]> {
  const merged = new Map<string, MacroDecision>()
  for (const w of draftByWindow) {
    for (const d of w.decisions) {
      const existing = merged.get(d.sectionId)
      if (!existing) {
        merged.set(d.sectionId, d)
      } else {
        merged.set(d.sectionId, pickBetterDecision(existing, d))
      }
    }
  }

  const contested: Section[] = []
  for (const w of draftByWindow) {
    for (const d of w.decisions) {
      const winning = merged.get(d.sectionId)
      if (winning && winning.verdict !== d.verdict) {
        const section = sections.find((s) => s.id === d.sectionId)
        if (section && !contested.some((c) => c.id === section.id)) {
          contested.push(section)
        }
      }
    }
  }

  if (contested.length === 0) {
    return sections.map((s) => merged.get(s.id) ?? fallbackDecision(s, 'no decision from any window'))
  }

  const draftPayload = draftByWindow
    .map((w) => {
      const filtered = w.decisions.filter((d) => contested.some((c) => c.id === d.sectionId))
      if (filtered.length === 0) return null
      return `Window ${w.windowIndex + 1} drafts:\n${filtered
        .map(
          (d) =>
            `- ${d.sectionId}: verdict=${d.verdict}, confidence=${d.confidence.toFixed(2)}, rationale="${d.rationale.replace(/"/g, '\\"')}"`,
        )
        .join('\n')}`
    })
    .filter((s): s is string => s !== null)
    .join('\n\n')

  const prompt = getPrompt('macro-filter')
  const user = [
    `Reconciliation pass. Reading purpose: ${ctx.purpose}`,
    '',
    'Narrative spine:',
    spinePayload(ctx.spine),
    '',
    'Canonical passages:',
    canonicalPayload(ctx.canonicalPassages),
    '',
    `Contested section summaries (resolve ONLY these): ${JSON.stringify(contested.map((c) => c.id))}`,
    contested.map(sectionSummaryLine).join('\n\n'),
    '',
    'Draft verdicts from prior windows:',
    draftPayload,
    '',
    'Reconcile contradictions. Prefer the higher-confidence verdict; if tied, prefer the verdict that preserves more material. Return decisions ONLY for the contested IDs.',
    'Return JSON: {"decisions":[…]}',
  ].join('\n')

  const result = await client.call({
    role: prompt.meta.role,
    temperature: prompt.meta.temperature,
    responseFormat: prompt.meta.responseFormat === 'json' ? { jsonSchema: {} } : 'text',
    system: prompt.body,
    user,
    signal: opts.signal,
    metadata: { phase: PHASE_NAME, requestId: 'phaseC1-reconcile' },
  })

  if (result.ok) {
    try {
      const parsed = responseSchema.parse(JSON.parse(result.data))
      for (const d of parsed.decisions) {
        merged.set(d.sectionId, d)
      }
    } catch {
      opts.emit?.({
        kind: 'phase-error',
        phase: PHASE_NAME,
        error: 'Reconciliation response failed schema; keeping prior best-effort decisions.',
      })
    }
  } else {
    opts.emit?.({
      kind: 'phase-error',
      phase: PHASE_NAME,
      error: `Reconciliation call failed: ${result.error.kind}`,
    })
  }

  return sections.map((s) => merged.get(s.id) ?? fallbackDecision(s, 'no decision from reconciliation'))
}

export async function phaseC1Macro(
  sections: Section[],
  ctx: Pick<BookContext, 'purpose' | 'spine' | 'canonicalPassages'>,
  client: LLMClient,
  opts: PhaseC1Options = {},
): Promise<MacroDecision[]> {
  const start = Date.now()
  const emit = opts.emit
  emit?.({ kind: 'phase-start', phase: PHASE_NAME })

  const chunkThreshold = opts.chunkThreshold ?? DEFAULT_CHUNK_THRESHOLD
  const chunkSize = opts.chunkSize ?? DEFAULT_CHUNK_SIZE
  const chunkOverlap = opts.chunkOverlap ?? DEFAULT_CHUNK_OVERLAP

  if (sections.length === 0) {
    emit?.({ kind: 'phase-end', phase: PHASE_NAME, durationMs: Date.now() - start })
    return []
  }

  if (sections.length <= chunkThreshold) {
    const decisions = await callMacroWithRetry(
      client,
      ctx,
      sections,
      [],
      null,
      'phaseC1-single',
      { emit, signal: opts.signal },
    )
    const byId = new Map(decisions.map((d) => [d.sectionId, d] as const))
    const result = sections.map(
      (s) => byId.get(s.id) ?? fallbackDecision(s, 'section omitted from single-call response'),
    )
    emit?.({ kind: 'phase-end', phase: PHASE_NAME, durationMs: Date.now() - start })
    return result
  }

  const windows = buildWindows(sections, chunkSize, chunkOverlap)
  let completed = 0
  const windowDrafts = await mapWithLimit(windows, DEFAULT_LLM_CONCURRENCY, async (w) => {
    if (opts.signal?.aborted) return null
    const decisions = await callMacroWithRetry(
      client,
      ctx,
      w.inScope,
      w.contextOnly,
      { windowIndex: w.windowIndex, windowCount: w.windowCount },
      `phaseC1-window-${w.windowIndex}`,
      { emit, signal: opts.signal },
    )
    completed += 1
    emit?.({
      kind: 'phase-progress',
      phase: PHASE_NAME,
      completed,
      total: windows.length + 1,
    })
    return { windowIndex: w.windowIndex, decisions }
  })
  const drafts = windowDrafts.filter(
    (d): d is { windowIndex: number; decisions: MacroDecision[] } => d !== null,
  )

  const reconciled = await reconcile(client, ctx, sections, drafts, { emit, signal: opts.signal })
  emit?.({
    kind: 'phase-progress',
    phase: PHASE_NAME,
    completed: windows.length + 1,
    total: windows.length + 1,
  })

  emit?.({ kind: 'phase-end', phase: PHASE_NAME, durationMs: Date.now() - start })
  return reconciled
}
