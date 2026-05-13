import { z } from 'zod'

import { DEFAULT_LLM_CONCURRENCY, mapWithLimit } from '@/lib/concurrency'
import { LLMClient } from '@/llm/client'
import { getPrompt } from '@/llm/prompts/loader'

import type {
  BookContext,
  CanonicalPassage,
  Emit,
  MacroDecision,
  NarrativeSpine,
  Section,
} from './types'

const PHASE_NAME = 'C1.5-sanity'
const DEFAULT_CONCURRENCY = DEFAULT_LLM_CONCURRENCY
const EDGE_CHARS = 600
const ESCALATED_CONFIDENCE = 0.8

const sanitySchema = z.object({
  escalate: z.boolean(),
  reason: z.string().min(1),
})

export type PhaseC15Options = {
  emit?: Emit
  signal?: AbortSignal
  concurrency?: number
}

function isCompressOrDrop(decision: MacroDecision): boolean {
  return decision.verdict === 'COMPRESS_TO_BRACKET' || decision.verdict === 'DROP_TO_ONE_LINE'
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

function openingAndClosing(section: Section): { opening: string; closing: string } {
  const text = section.rawText
  if (text.length <= EDGE_CHARS * 2) {
    return { opening: text, closing: '' }
  }
  return {
    opening: text.slice(0, EDGE_CHARS),
    closing: text.slice(text.length - EDGE_CHARS),
  }
}

async function checkOne(
  section: Section,
  decision: MacroDecision,
  ctx: Pick<BookContext, 'purpose' | 'spine' | 'canonicalPassages'>,
  client: LLMClient,
  opts: { emit?: Emit; signal?: AbortSignal },
): Promise<MacroDecision> {
  const prompt = getPrompt('sanity-pass')
  const { opening, closing } = openingAndClosing(section)
  const user = [
    `Reading purpose: ${ctx.purpose}`,
    '',
    'Narrative spine:',
    spinePayload(ctx.spine),
    '',
    'Canonical passages:',
    canonicalPayload(ctx.canonicalPassages),
    '',
    `Section under review: id="${section.id}" order=${section.order} title="${section.title}"`,
    `Current verdict: ${decision.verdict}`,
    `Current rationale: ${decision.rationale}`,
    '',
    `Opening (~${EDGE_CHARS} chars):\n${opening}`,
    '',
    closing ? `Closing (~${EDGE_CHARS} chars):\n${closing}` : '(section short enough that opening covers the whole text)',
    '',
    'Return JSON: {"escalate": <bool>, "reason": "…"}',
  ].join('\n')

  const result = await client.callWithBookContent({
    role: prompt.meta.role,
    temperature: prompt.meta.temperature,
    responseFormat: prompt.meta.responseFormat === 'json' ? { jsonSchema: {} } : 'text',
    system: prompt.body,
    user,
    bookContent: closing ? `${opening}\n\n[...elided middle...]\n\n${closing}` : opening,
    signal: opts.signal,
    metadata: {
      phase: PHASE_NAME,
      sectionId: section.id,
      requestId: `phaseC15-${section.id}`,
    },
  })

  if (!result.ok) {
    opts.emit?.({
      kind: 'phase-error',
      phase: PHASE_NAME,
      error: `Sanity call failed for ${section.id}: ${result.error.kind}`,
      sectionId: section.id,
    })
    return decision
  }

  try {
    const parsed = sanitySchema.parse(JSON.parse(result.data))
    if (!parsed.escalate) return decision
    return {
      ...decision,
      verdict: 'KEEP_PARTIAL',
      rationale: `${decision.rationale} | escalated by sanity pass: ${parsed.reason}`,
      confidence: Math.max(decision.confidence, ESCALATED_CONFIDENCE),
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    opts.emit?.({
      kind: 'phase-error',
      phase: PHASE_NAME,
      error: `Sanity JSON invalid for ${section.id}: ${message}`,
      sectionId: section.id,
    })
    return decision
  }
}

export async function phaseC15Sanity(
  sections: Section[],
  decisions: MacroDecision[],
  ctx: Pick<BookContext, 'purpose' | 'spine' | 'canonicalPassages'>,
  client: LLMClient,
  opts: PhaseC15Options = {},
): Promise<MacroDecision[]> {
  const start = Date.now()
  const emit = opts.emit
  const concurrency = opts.concurrency ?? DEFAULT_CONCURRENCY
  emit?.({ kind: 'phase-start', phase: PHASE_NAME })

  const sectionById = new Map(sections.map((s) => [s.id, s] as const))

  const targets: Array<{ index: number; decision: MacroDecision; section: Section }> = []
  decisions.forEach((decision, index) => {
    if (!isCompressOrDrop(decision)) return
    const section = sectionById.get(decision.sectionId)
    if (!section) {
      emit?.({
        kind: 'phase-error',
        phase: PHASE_NAME,
        error: `Decision references unknown sectionId ${decision.sectionId}`,
        sectionId: decision.sectionId,
      })
      return
    }
    targets.push({ index, decision, section })
  })

  if (targets.length === 0) {
    emit?.({ kind: 'phase-end', phase: PHASE_NAME, durationMs: Date.now() - start })
    return decisions.map((d) => ({ ...d }))
  }

  let completed = 0
  const updated = await mapWithLimit(targets, concurrency, async (t) => {
    if (opts.signal?.aborted) return { index: t.index, decision: t.decision }
    const result = await checkOne(t.section, t.decision, ctx, client, { emit, signal: opts.signal })
    completed += 1
    emit?.({
      kind: 'phase-progress',
      phase: PHASE_NAME,
      completed,
      total: targets.length,
      sectionId: t.section.id,
    })
    return { index: t.index, decision: result }
  })

  const next = decisions.map((d) => ({ ...d }))
  for (const u of updated) {
    next[u.index] = u.decision
  }

  emit?.({ kind: 'phase-end', phase: PHASE_NAME, durationMs: Date.now() - start })
  return next
}
