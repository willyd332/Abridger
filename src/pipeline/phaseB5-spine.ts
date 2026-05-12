import { z } from 'zod'

import { LLMClient } from '@/llm/client'
import { getPrompt } from '@/llm/prompts/loader'

import type { CanonicalPassage, Emit, NarrativeSpine, Section } from './types'

const PHASE_NAME = 'B5-spine'
const MIN_ANCHORS = 1
const MAX_ANCHORS = 4
const MIN_MOTIFS = 2
const MAX_MOTIFS = 10

const spineResponseSchema = z.object({
  centralArgument: z.string().min(1),
  narrativeShape: z.string().min(1),
  recurringMotifs: z.array(z.string().min(1)).min(MIN_MOTIFS).max(MAX_MOTIFS),
  voiceAnchors: z.array(z.string().min(1)).min(MIN_ANCHORS).max(MAX_ANCHORS),
})

export type PhaseB5Options = {
  emit?: Emit
  signal?: AbortSignal
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim()
}

function findAnchorInSections(anchor: string, sections: Section[]): boolean {
  const needle = normalize(anchor)
  if (needle.length < 12) return false
  for (const section of sections) {
    if (normalize(section.rawText).includes(needle)) return true
  }
  return false
}

function summarizesPayload(sections: Section[]): string {
  return sections
    .map((s) => {
      const signals = s.signals
        ? ` [function=${s.signals.narrativeFunction}, isCore=${s.signals.isCore}, famous=${s.signals.hasFamousArgument}, density=${s.signals.density}]`
        : ''
      const summary = s.summary ?? '[no summary]'
      const sample = s.voiceSample ? `\nVoice sample: "${s.voiceSample.replace(/\s+/g, ' ').trim()}"` : ''
      return `## Section ${s.order}: ${s.title}${signals}\n${summary}${sample}`
    })
    .join('\n\n')
}

function canonicalPayload(passages: CanonicalPassage[]): string {
  if (passages.length === 0) return '(none provided)'
  return passages
    .map((p, i) => `${i + 1}. ${p.description} (ref: ${p.pageOrSectionRef}${p.validated ? ', validated' : ''})`)
    .join('\n')
}

async function callSpine(
  client: LLMClient,
  purpose: string,
  sections: Section[],
  canonicalPassages: CanonicalPassage[],
  strictRetry: boolean,
  opts: PhaseB5Options,
): Promise<z.infer<typeof spineResponseSchema> | null> {
  const prompt = getPrompt('narrative-spine')
  const strictNote = strictRetry
    ? 'STRICT REQUIREMENT: every entry in voiceAnchors MUST be a verbatim substring (30–80 words) that appears in one of the section voice samples or summaries above. Do not paraphrase. Do not invent.'
    : 'Every voice anchor must be a verbatim 30–80-word passage that appears literally in one of the section voice samples or summaries above.'
  const user = [
    `Reading purpose: ${purpose}`,
    'Section summaries (in book order):',
    summarizesPayload(sections),
    '',
    'Canonical passages:',
    canonicalPayload(canonicalPassages),
    '',
    strictNote,
    'Return JSON: {"centralArgument":"…","narrativeShape":"…","recurringMotifs":["…"],"voiceAnchors":["…"]}',
  ].join('\n')

  const result = await client.call({
    role: prompt.meta.role,
    temperature: prompt.meta.temperature,
    responseFormat: prompt.meta.responseFormat === 'json' ? { jsonSchema: {} } : 'text',
    system: prompt.body,
    user,
    signal: opts.signal,
    metadata: { phase: PHASE_NAME, requestId: strictRetry ? 'phaseB5-strict' : 'phaseB5-initial' },
  })
  if (!result.ok) return null
  try {
    return spineResponseSchema.parse(JSON.parse(result.data))
  } catch {
    return null
  }
}

const FALLBACK_SPINE: NarrativeSpine = {
  centralArgument: '[narrative spine unavailable]',
  narrativeShape: '[narrative shape unavailable]',
  recurringMotifs: ['(none detected)', '(none detected)'],
  voiceAnchors: [],
}

export async function phaseB5Spine(
  sections: Section[],
  purpose: string,
  canonicalPassages: CanonicalPassage[],
  client: LLMClient,
  opts: PhaseB5Options = {},
): Promise<NarrativeSpine> {
  const start = Date.now()
  const emit = opts.emit
  emit?.({ kind: 'phase-start', phase: PHASE_NAME })

  let parsed = await callSpine(client, purpose, sections, canonicalPassages, false, opts)
  let validAnchors = parsed
    ? parsed.voiceAnchors.filter((a) => findAnchorInSections(a, sections))
    : []

  if (parsed && validAnchors.length < parsed.voiceAnchors.length) {
    const retry = await callSpine(client, purpose, sections, canonicalPassages, true, opts)
    if (retry) {
      parsed = retry
      validAnchors = retry.voiceAnchors.filter((a) => findAnchorInSections(a, sections))
    }
  }

  if (!parsed) {
    emit?.({
      kind: 'phase-error',
      phase: PHASE_NAME,
      error: 'Narrative spine call failed; using placeholder.',
    })
    emit?.({ kind: 'phase-end', phase: PHASE_NAME, durationMs: Date.now() - start })
    return FALLBACK_SPINE
  }

  if (validAnchors.length < parsed.voiceAnchors.length) {
    emit?.({
      kind: 'phase-error',
      phase: PHASE_NAME,
      error: 'Dropped unverifiable voice anchors after one strict retry.',
    })
  }

  const spine: NarrativeSpine = {
    centralArgument: parsed.centralArgument,
    narrativeShape: parsed.narrativeShape,
    recurringMotifs: parsed.recurringMotifs,
    voiceAnchors: validAnchors,
  }

  emit?.({ kind: 'phase-end', phase: PHASE_NAME, durationMs: Date.now() - start })
  return spine
}
