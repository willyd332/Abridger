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
