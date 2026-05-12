import { z } from 'zod'

import { getPrompt } from '@/llm/prompts/loader'

import {
  phaseC1Macro,
} from '@/pipeline'
import type {
  BookContext,
  BracketLengthHint,
  CanonicalPassage,
  MacroDecision,
  MacroVerdict,
  NarrativeSpine,
  Section,
} from '@/pipeline/types'

import {
  buildBookContext,
  checkAbort,
  commitCostFromMeter,
  finalizeOutputs,
  makeEmitter,
  persistMacroDecisions,
  recordPhase,
  runPhaseA,
  runPhaseA5,
  runPhaseB,
  runPhaseB5,
  runPhaseC15,
  runPhaseC2,
  runReconstruction,
} from './route-shared'
import type { RouteContext, RouteOutput } from './route-shared'

const PART_SIZE = 10
const PART_VERDICT_VALUES = [
  'KEEP_FULL',
  'KEEP_PARTIAL',
  'COMPRESS_TO_BRACKET',
  'DROP_TO_ONE_LINE',
] as const satisfies readonly MacroVerdict[]
const BRACKET_LENGTH_VALUES = ['one-line', 'short', 'medium', 'long'] as const satisfies readonly BracketLengthHint[]

const partDecisionSchema = z.object({
  partIndex: z.number().int().nonnegative(),
  verdict: z.enum(PART_VERDICT_VALUES),
  rationale: z.string().min(1),
  bracketLengthHint: z.enum(BRACKET_LENGTH_VALUES).optional(),
  confidence: z.number().min(0).max(1),
})

const partResponseSchema = z.object({
  parts: z.array(partDecisionSchema),
})

type PartGroup = {
  index: number
  sections: Section[]
}

export type LongBookOptions = {
  modelMapping: Record<string, string>
  promptHashes: Record<string, string>
  originalFileName: string
  startedAt: number
  partSize?: number
}

function groupIntoParts(sections: Section[], partSize: number): PartGroup[] {
  const out: PartGroup[] = []
  for (let i = 0; i < sections.length; i += partSize) {
    out.push({
      index: out.length,
      sections: sections.slice(i, Math.min(sections.length, i + partSize)),
    })
  }
  return out
}

function partPayload(part: PartGroup): string {
  const inner = part.sections
    .map((s) => {
      const signals = s.signals
        ? ` [function=${s.signals.narrativeFunction}, isCore=${s.signals.isCore}, density=${s.signals.density}]`
        : ''
      const summary = s.summary ?? '[no summary]'
      return `  - id="${s.id}" order=${s.order} title="${s.title}"${signals}\n    ${summary}`
    })
    .join('\n')
  return `Part ${part.index + 1} (sections ${part.sections[0]?.order ?? '?'}–${
    part.sections[part.sections.length - 1]?.order ?? '?'
  }):\n${inner}`
}

function spinePayload(spine: NarrativeSpine): string {
  return [
    `Central argument: ${spine.centralArgument}`,
    `Narrative shape: ${spine.narrativeShape}`,
    `Recurring motifs: ${spine.recurringMotifs.join(', ') || '(none)'}`,
  ].join('\n')
}

function canonicalPayload(passages: CanonicalPassage[]): string {
  if (passages.length === 0) return '(none provided)'
  return passages
    .map((p, i) => `${i + 1}. ${p.description} (ref: ${p.pageOrSectionRef})`)
    .join('\n')
}

async function runPartLevelMacro(
  ctx: RouteContext,
  parts: PartGroup[],
  bookCtx: BookContext,
): Promise<Map<number, z.infer<typeof partDecisionSchema>>> {
  const prompt = getPrompt('macro-filter')
  const user = [
    `Hierarchical macro filter — PART LEVEL. Reading purpose: ${bookCtx.purpose}`,
    '',
    'Narrative spine:',
    spinePayload(bookCtx.spine),
    '',
    'Canonical passages:',
    canonicalPayload(bookCtx.canonicalPassages),
    '',
    `The book has ${parts.length} parts of ~${PART_SIZE} sections each.`,
    'Decide for each PART whether to KEEP_FULL (each section processed normally),',
    'KEEP_PARTIAL (each section processed but with aggressive macro trimming),',
    'COMPRESS_TO_BRACKET (replace whole part with a single bracket),',
    'or DROP_TO_ONE_LINE (one-line bracket).',
    '',
    parts.map(partPayload).join('\n\n'),
    '',
    'Return JSON: {"parts":[{"partIndex":<int>,"verdict":"…","rationale":"…","bracketLengthHint":"…","confidence":0..1}]}',
  ].join('\n')

  const result = await ctx.client.call({
    role: prompt.meta.role,
    temperature: prompt.meta.temperature,
    responseFormat: prompt.meta.responseFormat === 'json' ? { jsonSchema: {} } : 'text',
    system: prompt.body,
    user,
    signal: ctx.signal,
    metadata: { phase: 'C1-macro', requestId: 'long-book-parts' },
  })

  const out = new Map<number, z.infer<typeof partDecisionSchema>>()
  if (!result.ok) return out

  try {
    const parsed = partResponseSchema.parse(JSON.parse(result.data))
    for (const p of parsed.parts) {
      out.set(p.partIndex, p)
    }
    return out
  } catch {
    return out
  }
}

function fallbackKeepDecision(section: Section, partDecision: z.infer<typeof partDecisionSchema>): MacroDecision {
  return {
    sectionId: section.id,
    verdict: partDecision.verdict === 'KEEP_FULL' ? 'KEEP_FULL' : 'KEEP_PARTIAL',
    rationale: `[long-book part default] part verdict ${partDecision.verdict}: ${partDecision.rationale}`,
    forwardDependencies: [],
    backwardDependencies: [],
    confidence: partDecision.confidence,
  }
}

function wholePartBracketDecision(
  section: Section,
  partDecision: z.infer<typeof partDecisionSchema>,
  isFirst: boolean,
): MacroDecision {
  return {
    sectionId: section.id,
    verdict: partDecision.verdict === 'DROP_TO_ONE_LINE' ? 'DROP_TO_ONE_LINE' : 'COMPRESS_TO_BRACKET',
    rationale: isFirst
      ? `[long-book part bracket] ${partDecision.rationale}`
      : `[long-book part bracket — absorbed into preceding section] ${partDecision.rationale}`,
    forwardDependencies: [],
    backwardDependencies: [],
    bracketLengthHint: partDecision.bracketLengthHint ?? (partDecision.verdict === 'DROP_TO_ONE_LINE' ? 'one-line' : 'medium'),
    confidence: partDecision.confidence,
  }
}

async function runHierarchicalMacro(
  ctx: RouteContext,
  emit: ReturnType<typeof makeEmitter>,
  sections: Section[],
  bookCtx: BookContext,
  partSize: number,
): Promise<MacroDecision[]> {
  await checkAbort(ctx)
  await recordPhase(ctx, 'C1')
  emit({ kind: 'phase-start', phase: 'C1-macro-hierarchical' })

  const parts = groupIntoParts(sections, partSize)
  const partDecisions = await runPartLevelMacro(ctx, parts, bookCtx)
  await commitCostFromMeter(ctx)

  const finalDecisions: MacroDecision[] = []

  for (const part of parts) {
    const decision = partDecisions.get(part.index)
    if (!decision) {
      const sub = await phaseC1Macro(part.sections, bookCtx, ctx.client, {
        emit,
        signal: ctx.signal,
      })
      for (const d of sub) finalDecisions.push(d)
      continue
    }

    if (decision.verdict === 'KEEP_FULL' || decision.verdict === 'KEEP_PARTIAL') {
      const sub = await phaseC1Macro(part.sections, bookCtx, ctx.client, {
        emit,
        signal: ctx.signal,
      })
      if (sub.length === part.sections.length) {
        for (const d of sub) finalDecisions.push(d)
      } else {
        for (const s of part.sections) finalDecisions.push(fallbackKeepDecision(s, decision))
      }
      continue
    }

    part.sections.forEach((s, i) => {
      finalDecisions.push(wholePartBracketDecision(s, decision, i === 0))
    })
  }

  await persistMacroDecisions(ctx, finalDecisions, 'C1')
  await commitCostFromMeter(ctx)
  emit({ kind: 'phase-end', phase: 'C1-macro-hierarchical', durationMs: 0 })
  return finalDecisions
}

export async function executeLongBookRoute(
  ctx: RouteContext,
  opts: LongBookOptions,
): Promise<RouteOutput> {
  const emit = makeEmitter(ctx)
  const partSize = opts.partSize ?? PART_SIZE

  const aSections = await runPhaseA(ctx, emit)

  const canonicalPassages = await runPhaseA5(ctx, emit)

  const summarized = await runPhaseB(ctx, emit, aSections)

  const spine = await runPhaseB5(ctx, emit, summarized, canonicalPassages)

  const bookCtx = buildBookContext(ctx.purpose, summarized, spine, canonicalPassages)

  const macroDraft = await runHierarchicalMacro(ctx, emit, summarized, bookCtx, partSize)

  const macroFinal = await runPhaseC15(ctx, emit, summarized, macroDraft, bookCtx)

  const microDecisions = await runPhaseC2(ctx, emit, summarized, macroFinal, bookCtx)

  const recon = await runReconstruction(ctx, emit, {
    sections: summarized,
    canonicalPassages,
    spine,
    ctx: bookCtx,
    macroDecisions: macroFinal,
    microDecisions,
  })

  return finalizeOutputs(
    ctx,
    recon,
    {
      sections: summarized,
      canonicalPassages,
      spine,
      ctx: bookCtx,
      macroDecisions: macroFinal,
      microDecisions,
    },
    opts.modelMapping,
    opts.promptHashes,
    opts.originalFileName,
    opts.startedAt,
  )
}
