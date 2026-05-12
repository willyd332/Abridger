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

export type NormalBookOptions = {
  modelMapping: Record<string, string>
  promptHashes: Record<string, string>
  originalFileName: string
  startedAt: number
}

export async function executeNormalBookRoute(
  ctx: RouteContext,
  opts: NormalBookOptions,
): Promise<RouteOutput> {
  const emit = makeEmitter(ctx)

  const aSections = await runPhaseA(ctx, emit)

  const meanConfidence =
    aSections.length === 0
      ? 0
      : aSections.reduce((s, sec) => s + sec.confidence, 0) / aSections.length

  if (meanConfidence < 0.4) {
    emit({
      kind: 'phase-error',
      phase: 'orchestrator',
      error: 'Phase A confidence low; downstream may benefit from no-chapter route.',
    })
  }

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
