import { z } from 'zod'

import { mapWithLimit } from '@/lib/concurrency'
import { LLMClient } from '@/llm/client'
import { getPrompt } from '@/llm/prompts/loader'

import type { Emit, Section } from './types'

const PHASE_NAME = 'B-summarize'
const DEFAULT_CONCURRENCY = 2
const SUMMARY_PLACEHOLDER = '[summary unavailable]'

const NARRATIVE_FUNCTION_VALUES = [
  'introduction',
  'argument',
  'evidence',
  'analysis',
  'case-study',
  'transition',
  'digression',
  'conclusion',
  'epilogue',
  'apparatus',
] as const

const summarizeResponseSchema = z.object({
  summary: z.string().min(1),
  signals: z.object({
    isCore: z.boolean(),
    hasFamousArgument: z.boolean(),
    narrativeFunction: z.enum(NARRATIVE_FUNCTION_VALUES),
    density: z.enum(['dense', 'medium', 'light']),
  }),
  voiceSample: z.string().min(20).max(500),
})

export type PhaseBOptions = {
  emit?: Emit
  signal?: AbortSignal
  concurrency?: number
  onSectionDone?: (section: Section) => void
}

function placeholderSection(section: Section): Section {
  return {
    ...section,
    summary: SUMMARY_PLACEHOLDER,
    signals: {
      isCore: false,
      hasFamousArgument: false,
      narrativeFunction: 'apparatus',
      density: 'light',
    },
    voiceSample: section.rawText.slice(0, 200) || section.title,
  }
}

async function summarizeOne(
  section: Section,
  purpose: string,
  client: LLMClient,
  opts: { emit?: Emit; signal?: AbortSignal },
): Promise<Section> {
  const prompt = getPrompt('summarize')
  const user = [
    `Reading purpose: ${purpose}`,
    `Section ${section.order}: "${section.title}" (pages ${section.startPage}–${section.endPage}).`,
    'Produce a 1–3 paragraph summary plus structured signals and a 50-word verbatim voice sample.',
    'Return JSON: {"summary":"…","signals":{"isCore":bool,"hasFamousArgument":bool,"narrativeFunction":"…","density":"…"},"voiceSample":"…"}',
  ].join('\n')

  const result = await client.callWithBookContent({
    role: prompt.meta.role,
    temperature: prompt.meta.temperature,
    responseFormat: prompt.meta.responseFormat === 'json' ? { jsonSchema: {} } : 'text',
    system: prompt.body,
    user,
    bookContent: section.rawText,
    signal: opts.signal,
    metadata: {
      phase: PHASE_NAME,
      sectionId: section.id,
      requestId: `phaseB-${section.id}`,
    },
  })

  if (!result.ok) {
    opts.emit?.({
      kind: 'phase-error',
      phase: PHASE_NAME,
      error: `Section ${section.id} failed: ${result.error.kind}`,
      sectionId: section.id,
    })
    return placeholderSection(section)
  }

  try {
    const parsed = summarizeResponseSchema.parse(JSON.parse(result.data))
    return {
      ...section,
      summary: parsed.summary,
      signals: parsed.signals,
      voiceSample: parsed.voiceSample,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    opts.emit?.({
      kind: 'phase-error',
      phase: PHASE_NAME,
      error: `Section ${section.id} JSON invalid: ${message}`,
      sectionId: section.id,
    })
    return placeholderSection(section)
  }
}

export async function phaseBSummarize(
  sections: Section[],
  purpose: string,
  client: LLMClient,
  opts: PhaseBOptions = {},
): Promise<Section[]> {
  const start = Date.now()
  const emit = opts.emit
  const concurrency = opts.concurrency ?? DEFAULT_CONCURRENCY
  emit?.({ kind: 'phase-start', phase: PHASE_NAME })

  let completed = 0
  const total = sections.length

  const results = await mapWithLimit(sections, concurrency, async (section) => {
    if (opts.signal?.aborted) {
      return placeholderSection(section)
    }
    const out = await summarizeOne(section, purpose, client, {
      emit,
      signal: opts.signal,
    })
    completed += 1
    emit?.({
      kind: 'phase-progress',
      phase: PHASE_NAME,
      completed,
      total,
      sectionId: out.id,
    })
    opts.onSectionDone?.(out)
    return out
  })

  emit?.({ kind: 'phase-end', phase: PHASE_NAME, durationMs: Date.now() - start })
  return results
}
