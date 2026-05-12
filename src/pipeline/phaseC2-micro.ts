import { z } from 'zod'

import { mapWithLimit } from '@/lib/concurrency'
import { LLMClient } from '@/llm/client'
import { getPrompt } from '@/llm/prompts/loader'
import type { Block } from '@/parsers/types'

import type {
  BookContext,
  CanonicalPassage,
  Emit,
  MacroDecision,
  MacroVerdict,
  MicroDecision,
  MicroDeletion,
  MicroDeletionBracketHint,
  MicroDeletionRejectionReason,
  NarrativeSpine,
  Section,
} from './types'

const PHASE_NAME = 'C2-micro'
const DEFAULT_CONCURRENCY = 2
const MAX_SNAP_DISTANCE = 40
const ORPHAN_LOOKAHEAD = 100
const ORPHAN_PRONOUN_REGEX = /^(he|she|they|it|this|that|those)\b/i

const BRACKET_LENGTH_VALUES = ['one-line', 'short', 'medium'] as const satisfies readonly MicroDeletionBracketHint[]

const proposedDeletionSchema = z.object({
  startOffset: z.number().int().nonnegative(),
  endOffset: z.number().int().nonnegative(),
  dropRationale: z.string().min(1),
  bracketLengthHint: z.enum(BRACKET_LENGTH_VALUES),
})

const responseSchema = z.object({
  deletions: z.array(proposedDeletionSchema),
})

type ProposedDeletion = z.infer<typeof proposedDeletionSchema>

const PROTECTED_CLOSE = '<<<END PROTECTED>>>'

export type PhaseC2Options = {
  emit?: Emit
  signal?: AbortSignal
  concurrency?: number
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

function otherSummariesPayload(allSummaries: BookContext['allSectionSummaries'], currentId: string): string {
  const lines = allSummaries
    .filter((s) => s.id !== currentId)
    .map((s) => {
      const signals = s.signals
        ? ` [function=${s.signals.narrativeFunction}, isCore=${s.signals.isCore}, density=${s.signals.density}]`
        : ''
      const summary = s.summary ?? '[no summary]'
      return `- id="${s.id}" order=${s.order} title="${s.title}"${signals}\n  ${summary}`
    })
  if (lines.length === 0) return '(no other sections)'
  return lines.join('\n\n')
}

function aggressivenessHint(verdict: MacroVerdict): string {
  switch (verdict) {
    case 'KEEP_FULL':
      return 'Macro verdict KEEP_FULL: trim only obvious low-yield material; target ~5–15% of the section bytes.'
    case 'KEEP_PARTIAL':
      return 'Macro verdict KEEP_PARTIAL: look for substantial trimmings; target ~30–50% of the section bytes.'
    default:
      return ''
  }
}

type ProtectedRegion = {
  blockId: string
  startOffset: number
  endOffset: number
}

function buildAnnotatedText(section: Section): {
  annotated: string
  protectedRegions: ProtectedRegion[]
  blockIndex: Array<{ id: string; startOffset: number; endOffset: number; classification: Block['classification'] }>
} {
  const protectedRegions: ProtectedRegion[] = []
  const blockIndex: Array<{ id: string; startOffset: number; endOffset: number; classification: Block['classification'] }> = []
  const body = section.blocks.filter(
    (b) => b.classification === 'body' || b.classification === 'protected' || b.classification === 'caption' || b.classification === 'footnote',
  )
  if (body.length === 0) {
    return { annotated: section.rawText, protectedRegions: [], blockIndex: [] }
  }
  const parts: string[] = []
  let cursor = 0
  body.forEach((block, i) => {
    const sep = i === 0 ? '' : '\n\n'
    if (sep) {
      parts.push(sep)
      cursor += sep.length
    }
    if (block.classification === 'protected') {
      const open = `<<<PROTECTED:${block.id}>>>\n`
      const close = `\n${PROTECTED_CLOSE}`
      const innerStart = cursor + open.length
      parts.push(open)
      parts.push(block.text)
      parts.push(close)
      const innerEnd = innerStart + block.text.length
      const totalStart = cursor
      const totalEnd = innerEnd + close.length
      protectedRegions.push({ blockId: block.id, startOffset: totalStart, endOffset: totalEnd })
      blockIndex.push({ id: block.id, startOffset: innerStart, endOffset: innerEnd, classification: 'protected' })
      cursor = totalEnd
    } else {
      const startOffset = cursor
      parts.push(block.text)
      cursor += block.text.length
      blockIndex.push({ id: block.id, startOffset, endOffset: cursor, classification: block.classification })
    }
  })
  return { annotated: parts.join(''), protectedRegions, blockIndex }
}

function isSentenceBoundary(text: string, position: number): boolean {
  if (position <= 0 || position >= text.length) return true
  const prev = text.charAt(position - 1)
  const next = text.charAt(position)
  if (/[.?!]/.test(prev) && /\s/.test(next)) return true
  if (/\s/.test(prev) && /[A-Z"'(“‘]/.test(next)) {
    const earlier = text.slice(Math.max(0, position - 4), position - 1)
    if (/[.?!]\s*$/.test(earlier)) return true
  }
  if (prev === '\n' && next === '\n') return true
  return false
}

function snapToSentenceBoundary(
  text: string,
  position: number,
  direction: 'start' | 'end',
): number | null {
  if (isSentenceBoundary(text, position)) return position
  for (let delta = 1; delta <= MAX_SNAP_DISTANCE; delta += 1) {
    const forward = position + delta
    if (forward < text.length && isSentenceBoundary(text, forward)) {
      if (direction === 'end' || delta <= MAX_SNAP_DISTANCE) return forward
    }
    const backward = position - delta
    if (backward >= 0 && isSentenceBoundary(text, backward)) {
      if (direction === 'start' || delta <= MAX_SNAP_DISTANCE) return backward
    }
  }
  return null
}

function intersectsProtected(
  startOffset: number,
  endOffset: number,
  regions: ProtectedRegion[],
): boolean {
  for (const r of regions) {
    const overlapStart = Math.max(startOffset, r.startOffset)
    const overlapEnd = Math.min(endOffset, r.endOffset)
    if (overlapStart < overlapEnd) return true
  }
  return false
}

function spansMultipleParagraphs(text: string, startOffset: number, endOffset: number): boolean {
  const slice = text.slice(startOffset, endOffset)
  return /\n\s*\n/.test(slice)
}

function orphansPronoun(text: string, endOffset: number): boolean {
  const after = text.slice(endOffset, endOffset + ORPHAN_LOOKAHEAD).trimStart()
  return ORPHAN_PRONOUN_REGEX.test(after)
}

function containedBlocks(
  startOffset: number,
  endOffset: number,
  blockIndex: ReturnType<typeof buildAnnotatedText>['blockIndex'],
): string[] {
  return blockIndex
    .filter((b) => b.startOffset >= startOffset && b.endOffset <= endOffset)
    .map((b) => b.id)
}

type PreflightOutcome =
  | { ok: true; deletion: MicroDeletion }
  | { ok: false; reason: MicroDeletionRejectionReason; proposed: MicroDeletion }

function preflight(
  proposed: ProposedDeletion,
  text: string,
  protectedRegions: ProtectedRegion[],
  blockIndex: ReturnType<typeof buildAnnotatedText>['blockIndex'],
): PreflightOutcome {
  const baseProposed: MicroDeletion = {
    startOffset: proposed.startOffset,
    endOffset: proposed.endOffset,
    containedBlockIds: [],
    dropRationale: proposed.dropRationale,
    bracketLengthHint: proposed.bracketLengthHint,
  }

  if (
    proposed.startOffset < 0 ||
    proposed.endOffset > text.length ||
    proposed.startOffset >= proposed.endOffset
  ) {
    return { ok: false, reason: 'out-of-bounds', proposed: baseProposed }
  }

  if (intersectsProtected(proposed.startOffset, proposed.endOffset, protectedRegions)) {
    return { ok: false, reason: 'crosses-protected-block', proposed: baseProposed }
  }

  let { startOffset, endOffset } = proposed
  if (!isSentenceBoundary(text, startOffset)) {
    const snapped = snapToSentenceBoundary(text, startOffset, 'start')
    if (snapped === null || Math.abs(snapped - startOffset) > MAX_SNAP_DISTANCE) {
      return { ok: false, reason: 'splits-sentence', proposed: baseProposed }
    }
    startOffset = snapped
  }
  if (!isSentenceBoundary(text, endOffset)) {
    const snapped = snapToSentenceBoundary(text, endOffset, 'end')
    if (snapped === null || Math.abs(snapped - endOffset) > MAX_SNAP_DISTANCE) {
      return { ok: false, reason: 'splits-sentence', proposed: baseProposed }
    }
    endOffset = snapped
  }

  if (startOffset >= endOffset) {
    return { ok: false, reason: 'out-of-bounds', proposed: baseProposed }
  }

  if (spansMultipleParagraphs(text, startOffset, endOffset)) {
    return { ok: false, reason: 'spans-multiple-paragraphs', proposed: baseProposed }
  }

  if (orphansPronoun(text, endOffset)) {
    return { ok: false, reason: 'orphans-pronoun', proposed: baseProposed }
  }

  return {
    ok: true,
    deletion: {
      startOffset,
      endOffset,
      containedBlockIds: containedBlocks(startOffset, endOffset, blockIndex),
      dropRationale: proposed.dropRationale,
      bracketLengthHint: proposed.bracketLengthHint,
    },
  }
}

async function microOne(
  section: Section,
  decision: MacroDecision,
  ctx: BookContext,
  client: LLMClient,
  opts: { emit?: Emit; signal?: AbortSignal },
): Promise<MicroDecision> {
  const { annotated, protectedRegions, blockIndex } = buildAnnotatedText(section)
  const prompt = getPrompt('micro-filter')
  const user = [
    `Reading purpose: ${ctx.purpose}`,
    '',
    'Narrative spine:',
    spinePayload(ctx.spine),
    '',
    'Canonical passages:',
    canonicalPayload(ctx.canonicalPassages),
    '',
    'Other sections (context):',
    otherSummariesPayload(ctx.allSectionSummaries, section.id),
    '',
    `Current section: id="${section.id}" order=${section.order} title="${section.title}"`,
    aggressivenessHint(decision.verdict),
    `Section length (chars in <book_content>): ${annotated.length}`,
    '',
    'Return JSON: {"deletions":[{"startOffset":<int>,"endOffset":<int>,"dropRationale":"…","bracketLengthHint":"one-line"|"short"|"medium"}]}',
  ].join('\n')

  const result = await client.callWithBookContent({
    role: prompt.meta.role,
    temperature: prompt.meta.temperature,
    responseFormat: prompt.meta.responseFormat === 'json' ? { jsonSchema: {} } : 'text',
    system: prompt.body,
    user,
    bookContent: annotated,
    signal: opts.signal,
    metadata: {
      phase: PHASE_NAME,
      sectionId: section.id,
      requestId: `phaseC2-${section.id}`,
    },
  })

  if (!result.ok) {
    opts.emit?.({
      kind: 'phase-error',
      phase: PHASE_NAME,
      error: `Micro call failed for ${section.id}: ${result.error.kind}`,
      sectionId: section.id,
    })
    return { sectionId: section.id, deletions: [], rejectedDeletions: [] }
  }

  let parsed: z.infer<typeof responseSchema>
  try {
    parsed = responseSchema.parse(JSON.parse(result.data))
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    opts.emit?.({
      kind: 'phase-error',
      phase: PHASE_NAME,
      error: `Micro JSON invalid for ${section.id}: ${message}`,
      sectionId: section.id,
    })
    return { sectionId: section.id, deletions: [], rejectedDeletions: [] }
  }

  const accepted: MicroDeletion[] = []
  const rejected: MicroDecision['rejectedDeletions'] = []
  for (const proposed of parsed.deletions) {
    const outcome = preflight(proposed, annotated, protectedRegions, blockIndex)
    if (outcome.ok) {
      accepted.push(outcome.deletion)
    } else {
      rejected.push({ proposed: outcome.proposed, reason: outcome.reason })
    }
  }

  return {
    sectionId: section.id,
    deletions: accepted,
    rejectedDeletions: rejected,
  }
}

export async function phaseC2Micro(
  sections: Section[],
  decisions: MacroDecision[],
  ctx: BookContext,
  client: LLMClient,
  opts: PhaseC2Options = {},
): Promise<MicroDecision[]> {
  const start = Date.now()
  const emit = opts.emit
  const concurrency = opts.concurrency ?? DEFAULT_CONCURRENCY
  emit?.({ kind: 'phase-start', phase: PHASE_NAME })

  const sectionById = new Map(sections.map((s) => [s.id, s] as const))
  const targets: Array<{ section: Section; decision: MacroDecision }> = []
  for (const decision of decisions) {
    if (decision.verdict !== 'KEEP_FULL' && decision.verdict !== 'KEEP_PARTIAL') continue
    const section = sectionById.get(decision.sectionId)
    if (!section) {
      emit?.({
        kind: 'phase-error',
        phase: PHASE_NAME,
        error: `Decision references unknown sectionId ${decision.sectionId}`,
        sectionId: decision.sectionId,
      })
      continue
    }
    targets.push({ section, decision })
  }

  if (targets.length === 0) {
    emit?.({ kind: 'phase-end', phase: PHASE_NAME, durationMs: Date.now() - start })
    return []
  }

  let completed = 0
  const results = await mapWithLimit(targets, concurrency, async (t) => {
    if (opts.signal?.aborted) {
      return { sectionId: t.section.id, deletions: [], rejectedDeletions: [] }
    }
    const out = await microOne(t.section, t.decision, ctx, client, { emit, signal: opts.signal })
    completed += 1
    emit?.({
      kind: 'phase-progress',
      phase: PHASE_NAME,
      completed,
      total: targets.length,
      sectionId: out.sectionId,
    })
    return out
  })

  emit?.({ kind: 'phase-end', phase: PHASE_NAME, durationMs: Date.now() - start })
  return results
}
