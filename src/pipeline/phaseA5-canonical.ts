import { z } from 'zod'

import { LLMClient } from '@/llm/client'
import { parseLlmJsonOrThrow } from '@/llm/parse-json'
import { getPrompt } from '@/llm/prompts/loader'
import type { ParsedBook } from '@/parsers/types'

import type { CanonicalPassage, Emit } from './types'

const PHASE_NAME = 'A5-canonical'
const MIN_PHRASE_WORDS = 6
const MAX_PASSAGES = 25

const responseSchema = z.object({
  passages: z
    .array(
      z.object({
        description: z.string().min(3),
        pageOrSectionRef: z.string().min(1),
      }),
    )
    .max(MAX_PASSAGES),
})

export type PhaseA5Options = {
  emit?: Emit
  signal?: AbortSignal
  includeUnvalidated?: boolean
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim()
}

function extractCandidatePhrases(description: string): string[] {
  const normalized = description.replace(/[“”"‘’']/g, '"')
  const quoted = Array.from(normalized.matchAll(/"([^"]{8,})"/g)).map((m) => m[1].trim())
  if (quoted.length > 0) return quoted
  const words = normalized.split(/\s+/).filter(Boolean)
  if (words.length < MIN_PHRASE_WORDS) return []
  const phrases: string[] = []
  for (let i = 0; i + MIN_PHRASE_WORDS <= words.length; i += MIN_PHRASE_WORDS) {
    phrases.push(words.slice(i, i + MIN_PHRASE_WORDS).join(' '))
  }
  return phrases
}

function findMatch(rawTextNormalized: string, phrases: string[]): string | undefined {
  for (const phrase of phrases) {
    const needle = normalize(phrase)
    if (needle.length < 12) continue
    if (rawTextNormalized.includes(needle)) return phrase
  }
  return undefined
}

export async function phaseA5Canonical(
  book: ParsedBook,
  client: LLMClient,
  opts: PhaseA5Options = {},
): Promise<CanonicalPassage[]> {
  const start = Date.now()
  const emit = opts.emit
  emit?.({ kind: 'phase-start', phase: PHASE_NAME })

  if (!book.title || !book.title.trim()) {
    emit?.({ kind: 'phase-end', phase: PHASE_NAME, durationMs: Date.now() - start })
    return []
  }

  const prompt = getPrompt('canonical-passages')
  const user = [
    `Title: ${book.title.trim()}`,
    `Author: ${book.author?.trim() || 'unknown'}`,
    'List famous or widely-cited passages from this book. For each, provide a short description and a page or chapter reference.',
    'Return JSON: {"passages":[{"description":"…","pageOrSectionRef":"…"}]}',
    'If the book is obscure or you are uncertain, return an empty passages array. Do not invent.',
  ].join('\n')

  const result = await client.call({
    role: prompt.meta.role,
    temperature: prompt.meta.temperature,
    responseFormat: prompt.meta.responseFormat === 'json' ? { jsonSchema: {} } : 'text',
    system: prompt.body,
    user,
    signal: opts.signal,
    metadata: { phase: PHASE_NAME, requestId: `phaseA5-${book.id}` },
  })

  if (!result.ok) {
    emit?.({
      kind: 'phase-error',
      phase: PHASE_NAME,
      error: `Canonical-passages call failed: ${result.error.kind}`,
    })
    emit?.({ kind: 'phase-end', phase: PHASE_NAME, durationMs: Date.now() - start })
    return []
  }

  let parsed: z.infer<typeof responseSchema>
  try {
    parsed = responseSchema.parse(parseLlmJsonOrThrow(result.data))
  } catch (err) {
    emit?.({
      kind: 'phase-error',
      phase: PHASE_NAME,
      error: `Canonical-passages JSON invalid: ${err instanceof Error ? err.message : String(err)}`,
    })
    emit?.({ kind: 'phase-end', phase: PHASE_NAME, durationMs: Date.now() - start })
    return []
  }

  const rawTextNormalized = normalize(book.rawText)
  const validated: CanonicalPassage[] = parsed.passages.map((p) => {
    const phrases = extractCandidatePhrases(p.description)
    const match = findMatch(rawTextNormalized, phrases)
    return {
      description: p.description,
      pageOrSectionRef: p.pageOrSectionRef,
      validated: Boolean(match),
      matchedSnippet: match,
    }
  })

  emit?.({ kind: 'phase-end', phase: PHASE_NAME, durationMs: Date.now() - start })
  return opts.includeUnvalidated ? validated : validated.filter((p) => p.validated)
}
