import { z } from 'zod'

import { getPrompt } from '@/llm/prompts/loader'
import type { Block, ParsedBook } from '@/parsers/types'

import {
  buildAbridgedEpubFromText,
  parseAbridgedSegments,
} from '@/pipeline/phaseD-reconstruct/epub'
import { buildLedger } from '@/pipeline/phaseD-reconstruct/ledger'
import { reconstructPdf } from '@/pipeline/phaseD-reconstruct/pdf-reflow'
import type {
  CanonicalPassage,
  MacroDecision,
  MicroDecision,
  NarrativeSpine,
  Section,
} from '@/pipeline/types'

import {
  brackets as bracketsStore,
  events as eventsStore,
  outputs as outputsStore,
  runs as runsStore,
  spine as spineStore,
  sections as sectionsStore,
} from '@/state'
import { defaultSectionPhaseStatus } from '@/state/types'

import {
  checkAbort,
  commitCostFromMeter,
  makeEmitter,
  recordPhase,
} from './route-shared'
import type { RouteContext, RouteOutput } from './route-shared'

const PHASE_NAME = 'short-book'

const ledgerEntrySchema = z.object({
  cutLocation: z.string().min(1),
  replacementBracket: z.string().min(1),
  rationale: z.string().min(1),
})

const shortBookResponseSchema = z.object({
  abridged: z.string().min(1),
  ledger: z.array(ledgerEntrySchema),
})

export type ShortBookOptions = {
  modelMapping: Record<string, string>
  promptHashes: Record<string, string>
  originalFileName: string
  startedAt: number
}

function syntheticSpine(book: ParsedBook, purpose: string): NarrativeSpine {
  return {
    centralArgument: `Short-book single-pass abridgement for: ${purpose || '(no purpose given)'}`,
    narrativeShape: book.title
      ? `Single-pass abridgement of "${book.title}".`
      : 'Single-pass short-book abridgement.',
    recurringMotifs: ['(short-book: motifs not extracted)', '(short-book: motifs not extracted)'],
    voiceAnchors: [],
  }
}

function syntheticSection(book: ParsedBook, rawText: string): Section {
  const blocks: Block[] = [
    {
      id: 'short-book-body-001',
      text: rawText,
      classification: 'body',
      pageNumber: book.pages[0]?.number ?? 1,
    },
  ]
  return {
    id: 'sec-short-book-001',
    order: 1,
    title: book.title ?? 'Abridged book',
    startPage: book.pages[0]?.number ?? 1,
    endPage: book.pages[book.pages.length - 1]?.number ?? 1,
    blocks,
    rawText,
    source: 'llm-detected',
    confidence: 1,
    summary: 'Whole-book single-pass abridgement.',
    voiceSample: rawText.slice(0, 240),
  }
}

function strippedAbridgedText(abridged: string): string {
  return abridged
    .replace(/<<<BR>>>/g, '')
    .replace(/<<<\/BR>>>/g, '')
}

export async function executeShortBookRoute(
  ctx: RouteContext,
  opts: ShortBookOptions,
): Promise<RouteOutput> {
  const emit = makeEmitter(ctx)
  await checkAbort(ctx)
  await recordPhase(ctx, 'short-book-single-call')
  emit({ kind: 'phase-start', phase: PHASE_NAME })

  const prompt = getPrompt('short-book')
  const user = [
    `Reading purpose: ${ctx.purpose}`,
    bookMetadata(ctx),
    'Abridge to ~40% of original length. Preserve voice, named entities, and quotes. Emit JSON only.',
  ].join('\n')

  const result = await ctx.client.callWithBookContent({
    role: prompt.meta.role,
    temperature: prompt.meta.temperature,
    responseFormat: prompt.meta.responseFormat === 'json' ? { jsonSchema: {} } : 'text',
    system: prompt.body,
    user,
    bookContent: ctx.book.rawText,
    signal: ctx.signal,
    metadata: { phase: PHASE_NAME, requestId: `short-book-${ctx.runId}` },
  })

  await commitCostFromMeter(ctx)

  if (!result.ok) {
    emit({
      kind: 'phase-error',
      phase: PHASE_NAME,
      error: `Short-book call failed: ${result.error.kind}`,
    })
    throw new Error(`Short-book call failed: ${result.error.kind}`)
  }

  let parsed: z.infer<typeof shortBookResponseSchema>
  try {
    parsed = shortBookResponseSchema.parse(JSON.parse(result.data))
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    emit({ kind: 'phase-error', phase: PHASE_NAME, error: `Short-book JSON invalid: ${message}` })
    throw new Error(`Short-book JSON invalid: ${message}`)
  }

  const segments = parseAbridgedSegments(parsed.abridged)
  const visibleAbridged = strippedAbridgedText(parsed.abridged)

  const section = syntheticSection(ctx.book, visibleAbridged)
  await sectionsStore.create({
    runId: ctx.runId,
    sectionId: section.id,
    order: section.order,
    section,
    phaseStatus: defaultSectionPhaseStatus(),
  })

  const macroDecision: MacroDecision = {
    sectionId: section.id,
    verdict: 'KEEP_FULL',
    rationale: `Short-book single-pass abridgement; ${parsed.ledger.length} editorial brackets inline.`,
    forwardDependencies: [],
    backwardDependencies: [],
    confidence: 0.9,
  }
  const microDecision: MicroDecision = {
    sectionId: section.id,
    deletions: [],
    rejectedDeletions: [],
  }

  const spine = syntheticSpine(ctx.book, ctx.purpose)
  const canonicalPassages: CanonicalPassage[] = []
  await spineStore.create({ runId: ctx.runId, spine, canonicalPassages })

  for (let i = 0; i < parsed.ledger.length; i += 1) {
    const entry = parsed.ledger[i]
    await bracketsStore.create({
      runId: ctx.runId,
      sectionId: section.id,
      deletionIndex: i,
      bracketText: entry.replacementBracket,
      producedAt: Date.now(),
      model: opts.modelMapping.smart ?? 'unknown',
    })
    await eventsStore.append({
      runId: ctx.runId,
      timestamp: Date.now(),
      event: {
        kind: 'phase-progress',
        phase: PHASE_NAME,
        completed: i + 1,
        total: parsed.ledger.length,
      },
    })
  }

  await sectionsStore.update(ctx.runId, section.id, { macroDecision, microDecision })

  const abridgedKind = ctx.book.format === 'pdf' ? 'abridged-pdf' : 'abridged-epub'
  const abridgedMimeType = ctx.book.format === 'pdf' ? 'application/pdf' : 'application/epub+zip'

  let abridgedBlob: Blob
  let abridgedPages: number

  if (ctx.book.format === 'pdf') {
    const pdfResult = await reconstructPdf(
      {
        parsedBook: ctx.book,
        sections: [section],
        macroDecisions: [macroDecision],
        microDecisions: [microDecision],
        ctx: {
          purpose: ctx.purpose,
          spine,
          canonicalPassages,
          allSectionSummaries: [
            {
              id: section.id,
              title: section.title,
              order: section.order,
              summary: section.summary,
              signals: section.signals,
            },
          ],
        },
        client: ctx.client,
      },
      { emit, signal: ctx.signal },
    )
    abridgedBlob = pdfResult.abridgedBlob
    abridgedPages = pdfResult.stats.abridgedPages
  } else {
    const epubResult = await buildAbridgedEpubFromText({
      originalBlob: ctx.originalBlob,
      parsedBook: ctx.book,
      segments,
    })
    abridgedBlob = epubResult.abridgedBlob
    abridgedPages = epubResult.stats.abridgedPages
  }

  const run = await runsStore.get(ctx.runId)
  const totalCostUsd = run?.cost.billedUsd ?? 0

  const bracketsForLedger = parsed.ledger.map((entry, i) => ({
    sectionId: section.id,
    deletionIndex: i,
    bracketText: entry.replacementBracket,
  }))

  const ledger = buildLedger({
    parsedBook: ctx.book,
    sections: [section],
    macroDecisions: [macroDecision],
    microDecisions: [microDecision],
    spine,
    canonicalPassages,
    brackets: bracketsForLedger,
    runId: ctx.runId,
    startedAt: opts.startedAt,
    finishedAt: Date.now(),
    modelMapping: opts.modelMapping,
    promptHashes: opts.promptHashes,
    totalCostUsd,
    purpose: ctx.purpose,
    originalFileName: opts.originalFileName,
  })

  await outputsStore.create({
    runId: ctx.runId,
    kind: abridgedKind,
    mimeType: abridgedMimeType,
    blob: abridgedBlob,
    producedAt: Date.now(),
  })
  await outputsStore.create({
    runId: ctx.runId,
    kind: 'ledger-md',
    mimeType: 'text/markdown',
    blob: ledger.blob,
    producedAt: Date.now(),
  })

  emit({ kind: 'phase-end', phase: PHASE_NAME, durationMs: Date.now() - opts.startedAt })

  return {
    abridgedBlob,
    ledgerBlob: ledger.blob,
    abridgedMimeType,
    ledgerMimeType: 'text/markdown',
    stats: {
      ...ledger.stats,
      ledgerEntries: parsed.ledger.length,
      abridgedLengthChars: visibleAbridged.length,
      abridgedPages,
    },
  }
}

function bookMetadata(ctx: RouteContext): string {
  return `Book metadata — title: "${ctx.book.title ?? ''}", author: "${ctx.book.author ?? ''}".`
}
