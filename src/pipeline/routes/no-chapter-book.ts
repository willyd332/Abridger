import type { Block, ParsedBook } from '@/parsers/types'

import type { Section } from '@/pipeline/types'

import {
  buildBookContext,
  finalizeOutputs,
  makeEmitter,
  runPhaseA,
  runPhaseA5,
  runPhaseB,
  runPhaseB5,
  runPhaseC1,
  runPhaseC15,
  runPhaseC2,
  runReconstruction,
} from './route-shared'
import type { RouteContext, RouteOutput } from './route-shared'

const DEFAULT_WINDOW_PAGES = 20

export type NoChapterBookOptions = {
  modelMapping: Record<string, string>
  promptHashes: Record<string, string>
  originalFileName: string
  startedAt: number
  windowPages?: number
}

function bodyTextFor(blocks: Block[]): string {
  return blocks
    .filter((b) => b.classification === 'body')
    .map((b) => b.text)
    .join('\n')
    .trim()
}

function buildFixedWindowSections(book: ParsedBook, windowPages: number): Section[] {
  if (book.pages.length === 0) return []
  const out: Section[] = []
  const totalPages = book.pages.length
  let order = 1
  for (let start = 0; start < totalPages; start += windowPages) {
    const slice = book.pages.slice(start, Math.min(totalPages, start + windowPages))
    const startPage = slice[0].number
    const endPage = slice[slice.length - 1].number
    const blocks: Block[] = []
    for (const page of slice) {
      for (const b of page.blocks) blocks.push(b)
    }
    out.push({
      id: `sec-window-${String(order).padStart(3, '0')}`,
      order,
      title: `Section ${order} (pp. ${startPage}–${endPage})`,
      startPage,
      endPage,
      blocks,
      rawText: bodyTextFor(blocks),
      source: 'fixed-window',
      confidence: 0.5,
    })
    order += 1
  }
  return out
}

export async function executeNoChapterBookRoute(
  ctx: RouteContext,
  opts: NoChapterBookOptions,
): Promise<RouteOutput> {
  const emit = makeEmitter(ctx)
  const windowPages = opts.windowPages ?? DEFAULT_WINDOW_PAGES

  const fixedSections = buildFixedWindowSections(ctx.book, windowPages)
  const aSections = await runPhaseA(ctx, emit, {
    bypassPhaseA: true,
    preBuiltSections: fixedSections,
  })

  const canonicalPassages = await runPhaseA5(ctx, emit)

  const summarized = await runPhaseB(ctx, emit, aSections)

  const spine = await runPhaseB5(ctx, emit, summarized, canonicalPassages)

  const bookCtx = buildBookContext(ctx.purpose, summarized, spine, canonicalPassages)

  const macroDraft = await runPhaseC1(ctx, emit, summarized, bookCtx)

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
