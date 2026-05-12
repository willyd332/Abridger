import { z } from 'zod'

import { LLMClient } from '@/llm/client'
import { getPrompt } from '@/llm/prompts/loader'

import type {
  BracketLengthHint,
  NarrativeSpine,
} from './types'

const PHASE_NAME = 'D-bracket-writer'

const responseSchema = z.object({
  bracketText: z.string().min(1),
})

export type BracketRequest = {
  deletedText: string
  precedingContext: string
  followingContext: string
  targetLength: BracketLengthHint
  spine: NarrativeSpine
  voiceSample: string
  purpose: string
  namedTermsToPreserve?: string[]
  scope: 'macro' | 'micro'
}

export type BracketUsage = {
  promptTokens: number
  completionTokens: number
  totalTokens: number
  costUsd: number
}

export type BracketResult = {
  text: string
  usage: BracketUsage
}

type LengthBudget = {
  minTokens: number
  maxTokens: number
  approxMaxWords: number
  guidance: string
}

const LENGTH_BUDGETS: Record<BracketLengthHint, LengthBudget> = {
  'one-line': {
    minTokens: 10,
    maxTokens: 40,
    approxMaxWords: 30,
    guidance: 'one short sentence (no more than ~30 words)',
  },
  short: {
    minTokens: 40,
    maxTokens: 150,
    approxMaxWords: 110,
    guidance: 'two to four sentences (~40-110 words)',
  },
  medium: {
    minTokens: 150,
    maxTokens: 500,
    approxMaxWords: 380,
    guidance: 'one or two paragraphs (~150-380 words)',
  },
  long: {
    minTokens: 500,
    maxTokens: 1500,
    approxMaxWords: 1100,
    guidance: 'up to ~2 pages (~500-1100 words)',
  },
}

const ZERO_USAGE: BracketUsage = {
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
  costUsd: 0,
}

function uniqueCapped<T>(items: ReadonlyArray<T>, max: number): T[] {
  const out: T[] = []
  const seen = new Set<T>()
  for (const item of items) {
    if (seen.has(item)) continue
    seen.add(item)
    out.push(item)
    if (out.length >= max) break
  }
  return out
}

export function extractNamedTerms(text: string): string[] {
  const properNounRe = /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g
  const properNouns = text.match(properNounRe) ?? []
  const yearRe = /\b\d{4}\b/g
  const years = text.match(yearRe) ?? []
  const quoteRe = /"[^"\n]{1,160}"|"[^"\n]{1,160}"/g
  const quotes = text.match(quoteRe) ?? []
  const proper = uniqueCapped(properNouns, 20)
  const yearList = uniqueCapped(years, 10)
  const quoteList = uniqueCapped(quotes, 5)
  return [...proper, ...yearList, ...quoteList]
}

function approxWordCount(text: string): number {
  const trimmed = text.trim()
  if (!trimmed) return 0
  return trimmed.split(/\s+/).length
}

function truncateToWords(text: string, maxWords: number): string {
  const words = text.trim().split(/\s+/)
  if (words.length <= maxWords) return text.trim()
  const truncated = words.slice(0, maxWords).join(' ').replace(/[,;:\s]+$/, '')
  return `${truncated}…`
}

function spineBlock(spine: NarrativeSpine): string {
  const motifs = spine.recurringMotifs.length > 0 ? spine.recurringMotifs.join(', ') : '(none)'
  return [
    `Central argument: ${spine.centralArgument}`,
    `Narrative shape: ${spine.narrativeShape}`,
    `Recurring motifs: ${motifs}`,
  ].join('\n')
}

function namedTermsBlock(terms: ReadonlyArray<string>): string {
  if (terms.length === 0) return '(none — preserve any proper nouns, dates, and numerical claims in the deleted span)'
  return terms.map((t) => `- ${t}`).join('\n')
}

function buildUserPrompt(
  request: BracketRequest,
  termsToPreserve: ReadonlyArray<string>,
  budget: LengthBudget,
  attempt: 'first' | 'strict',
): string {
  const strictNote =
    attempt === 'strict'
      ? `\nIMPORTANT: Your previous attempt exceeded the length budget. Respond with at most ${budget.approxMaxWords} words. Be terse.`
      : ''
  return [
    `Reading purpose: ${request.purpose}`,
    '',
    'Narrative spine:',
    spineBlock(request.spine),
    '',
    `Voice sample (mimic this register, rhythm, and tone):\n"${request.voiceSample}"`,
    '',
    `Scope: ${request.scope === 'macro' ? 'whole-section bracket (replaces an entire chapter or major section)' : 'inline bracket (replaces a mid-section passage between kept paragraphs)'}`,
    `Target length: ${request.targetLength} — ${budget.guidance}.`,
    '',
    'Preceding kept text (the bracket must follow on tonally):',
    `"${request.precedingContext.trim()}"`,
    '',
    'Following kept text (the bracket must lead into this):',
    `"${request.followingContext.trim()}"`,
    '',
    'Named terms / numbers / quotes the bracket MUST preserve from the deleted span:',
    namedTermsBlock(termsToPreserve),
    '',
    'Deleted span (provided inside <book_content>) — the bracket replaces this. Do not summarize encyclopedically; let the reader pick up where the preceding text left off.',
    strictNote,
    '',
    'Return JSON: {"bracketText": "…"}',
  ].join('\n')
}

function emitWarning(metadata: { requestId: string } | undefined, message: string): void {
  const tag = metadata?.requestId ? `[${metadata.requestId}] ` : ''
  console.warn(`${tag}bracket-writer: ${message}`)
}

async function attemptCall(
  request: BracketRequest,
  client: LLMClient,
  prompt: ReturnType<typeof getPrompt>,
  budget: LengthBudget,
  termsToPreserve: ReadonlyArray<string>,
  attempt: 'first' | 'strict',
  opts?: { signal?: AbortSignal; metadata?: { requestId: string } },
): Promise<
  | { ok: true; text: string; usage: BracketUsage }
  | { ok: false; usage: BracketUsage; reason: string }
> {
  const user = buildUserPrompt(request, termsToPreserve, budget, attempt)
  const requestId = opts?.metadata?.requestId ?? `bracket-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  const result = await client.callWithBookContent({
    role: prompt.meta.role,
    temperature: prompt.meta.temperature,
    responseFormat: prompt.meta.responseFormat === 'json' ? { jsonSchema: {} } : 'text',
    system: prompt.body,
    user,
    bookContent: request.deletedText,
    maxTokens: Math.min(budget.maxTokens * 2, 3000),
    signal: opts?.signal,
    metadata: {
      phase: PHASE_NAME,
      requestId,
    },
  })
  if (!result.ok) {
    return { ok: false, usage: ZERO_USAGE, reason: `LLM error: ${result.error.kind}` }
  }
  const usage: BracketUsage = {
    promptTokens: result.usage.promptTokens,
    completionTokens: result.usage.completionTokens,
    totalTokens: result.usage.totalTokens,
    costUsd: result.usage.costUsd,
  }
  let parsed: z.infer<typeof responseSchema>
  try {
    parsed = responseSchema.parse(JSON.parse(result.data))
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, usage, reason: `Invalid JSON: ${message}` }
  }
  return { ok: true, text: parsed.bracketText.trim(), usage }
}

function addUsage(a: BracketUsage, b: BracketUsage): BracketUsage {
  return {
    promptTokens: a.promptTokens + b.promptTokens,
    completionTokens: a.completionTokens + b.completionTokens,
    totalTokens: a.totalTokens + b.totalTokens,
    costUsd: a.costUsd + b.costUsd,
  }
}

export async function writeBracket(
  request: BracketRequest,
  client: LLMClient,
  opts?: { signal?: AbortSignal; metadata?: { requestId: string } },
): Promise<BracketResult> {
  const prompt = getPrompt('bracket-writer')
  const budget = LENGTH_BUDGETS[request.targetLength]
  const termsToPreserve =
    request.namedTermsToPreserve && request.namedTermsToPreserve.length > 0
      ? request.namedTermsToPreserve
      : extractNamedTerms(request.deletedText)

  const first = await attemptCall(request, client, prompt, budget, termsToPreserve, 'first', opts)
  let totalUsage: BracketUsage = first.usage

  let candidateText: string | null = null
  if (first.ok) {
    candidateText = first.text
  } else {
    emitWarning(opts?.metadata, first.reason)
  }

  const fiveXMaxWords = budget.approxMaxWords * 5
  const overshoot =
    candidateText !== null && approxWordCount(candidateText) > fiveXMaxWords

  if (candidateText === null || overshoot) {
    if (overshoot) {
      emitWarning(opts?.metadata, `length overshoot (${approxWordCount(candidateText ?? '')} words > 5× budget of ${budget.approxMaxWords}); retrying with strict instruction`)
    }
    const second = await attemptCall(request, client, prompt, budget, termsToPreserve, 'strict', opts)
    totalUsage = addUsage(totalUsage, second.usage)
    if (second.ok) {
      const stillOver = approxWordCount(second.text) > fiveXMaxWords
      if (stillOver) {
        emitWarning(opts?.metadata, `length overshoot persists after strict retry (${approxWordCount(second.text)} words); truncating at budget`)
        candidateText = truncateToWords(second.text, budget.approxMaxWords)
      } else {
        candidateText = second.text
      }
    } else {
      emitWarning(opts?.metadata, `strict retry failed (${second.reason}); using truncated first response if any`)
      if (candidateText) {
        candidateText = truncateToWords(candidateText, budget.approxMaxWords)
      } else {
        candidateText = `[bracket-writer failed; deleted ~${approxWordCount(request.deletedText)} words of source]`
      }
    }
  }

  return {
    text: candidateText,
    usage: totalUsage,
  }
}
