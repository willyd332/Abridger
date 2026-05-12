export type {
  BookContext,
  BracketLengthHint,
  CanonicalPassage,
  Emit,
  MacroDecision,
  MacroVerdict,
  MicroDecision,
  MicroDeletion,
  MicroDeletionBracketHint,
  MicroDeletionRejectionReason,
  NarrativeFunction,
  NarrativeSpine,
  PhaseEvent,
  Section,
  SectionDensity,
  SectionSignals,
  SectionSource,
} from './types'

export { phaseAStructure } from './phaseA-structure'
export type { OutlineNode, PhaseAOptions, PhaseAResult } from './phaseA-structure'

export { phaseA5Canonical } from './phaseA5-canonical'
export type { PhaseA5Options } from './phaseA5-canonical'

export { phaseBSummarize } from './phaseB-summarize'
export type { PhaseBOptions } from './phaseB-summarize'

export { phaseB5Spine } from './phaseB5-spine'
export type { PhaseB5Options } from './phaseB5-spine'

export { phaseC1Macro } from './phaseC1-macro'
export type { PhaseC1Options } from './phaseC1-macro'

export { phaseC15Sanity } from './phaseC15-sanity'
export type { PhaseC15Options } from './phaseC15-sanity'

export { phaseC2Micro } from './phaseC2-micro'
export type { PhaseC2Options } from './phaseC2-micro'

export { writeBracket, extractNamedTerms } from './bracket-writer'
export type { BracketRequest, BracketResult, BracketUsage } from './bracket-writer'

export { getPrecedingContext, getFollowingContext } from './bracket-helpers'

export { reconstructEpub } from './phaseD-reconstruct/epub'
export type {
  ReconstructEpubInput,
  ReconstructEpubOptions,
  ReconstructEpubOutput,
  ReconstructEpubStats,
  ReconstructedBracket,
} from './phaseD-reconstruct/epub'

export { reconstructPdf } from './phaseD-reconstruct/pdf-reflow'
export type {
  ReconstructPdfInput,
  ReconstructPdfOptions,
  ReconstructPdfOutput,
  ReconstructPdfStats,
} from './phaseD-reconstruct/pdf-reflow'
