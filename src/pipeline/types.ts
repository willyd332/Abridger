import type { Block } from '@/parsers/types'

export type NarrativeFunction =
  | 'introduction'
  | 'argument'
  | 'evidence'
  | 'analysis'
  | 'case-study'
  | 'transition'
  | 'digression'
  | 'conclusion'
  | 'epilogue'
  | 'apparatus'

export type SectionDensity = 'dense' | 'medium' | 'light'

export type SectionSignals = {
  isCore: boolean
  hasFamousArgument: boolean
  narrativeFunction: NarrativeFunction
  density: SectionDensity
}

export type SectionSource = 'outline' | 'llm-detected' | 'spine' | 'fixed-window'

export type Section = {
  id: string
  order: number
  title: string
  startPage: number
  endPage: number
  blocks: Block[]
  rawText: string
  summary?: string
  signals?: SectionSignals
  voiceSample?: string
  source: SectionSource
  confidence: number
}

export type CanonicalPassage = {
  description: string
  pageOrSectionRef: string
  validated: boolean
  matchedSnippet?: string
}

export type NarrativeSpine = {
  centralArgument: string
  narrativeShape: string
  recurringMotifs: string[]
  voiceAnchors: string[]
}

export type BookContext = {
  purpose: string
  spine: NarrativeSpine
  canonicalPassages: CanonicalPassage[]
  allSectionSummaries: Array<Pick<Section, 'id' | 'title' | 'order' | 'summary' | 'signals'>>
}

export type PhaseEvent =
  | { kind: 'phase-start'; phase: string }
  | { kind: 'phase-progress'; phase: string; completed: number; total: number; sectionId?: string }
  | { kind: 'phase-end'; phase: string; durationMs: number }
  | { kind: 'phase-error'; phase: string; error: string; sectionId?: string }

export type Emit = (event: PhaseEvent) => void

export type MacroVerdict =
  | 'KEEP_FULL'
  | 'KEEP_PARTIAL'
  | 'COMPRESS_TO_BRACKET'
  | 'DROP_TO_ONE_LINE'

export type BracketLengthHint = 'one-line' | 'short' | 'medium' | 'long'

export type MacroDecision = {
  sectionId: string
  verdict: MacroVerdict
  rationale: string
  forwardDependencies: string[]
  backwardDependencies: string[]
  bracketLengthHint?: BracketLengthHint
  confidence: number
}

export type MicroDeletionBracketHint = 'one-line' | 'short' | 'medium'

export type MicroDeletion = {
  startOffset: number
  endOffset: number
  containedBlockIds: string[]
  dropRationale: string
  bracketLengthHint: MicroDeletionBracketHint
}

export type MicroDeletionRejectionReason =
  | 'splits-sentence'
  | 'orphans-pronoun'
  | 'crosses-protected-block'
  | 'spans-multiple-paragraphs'
  | 'out-of-bounds'

export type MicroDecision = {
  sectionId: string
  deletions: MicroDeletion[]
  rejectedDeletions: Array<{
    proposed: MicroDeletion
    reason: MicroDeletionRejectionReason
  }>
}
