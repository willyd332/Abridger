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

export type NarrativeSpine = {
  centralArgument: string
  narrativeShape: string
  recurringMotifs: string[]
  voiceAnchors: string[]
}

export type PhaseSampleSource = 'book' | 'reasoning'

export type PhaseEvent =
  | { kind: 'phase-start'; phase: string }
  | {
      kind: 'phase-progress'
      phase: string
      completed: number
      total: number
      sectionId?: string
    }
  | { kind: 'phase-end'; phase: string; durationMs: number }
  | { kind: 'phase-error'; phase: string; error: string; sectionId?: string }
  | {
      kind: 'phase-warning'
      phase: string
      warning: string
      sectionId?: string
      details?: Record<string, unknown>
    }
  | {
      kind: 'phase-sample'
      phase: string
      source: PhaseSampleSource
      text: string
      sectionId?: string
    }
  | {
      kind: 'tree-node'
      phase: string
      nodeId: string
      parentId: string | null
      depth: number
      title: string
      isLeaf: boolean
      summarized?: boolean
    }
  | {
      kind: 'budget-pause'
      paused: boolean
      reservedUsd: number
      billedUsd: number
      ceilingUsd: number
      pendingCount: number
    }

export type Emit = (event: PhaseEvent) => void

export type BracketLengthHint = 'one-line' | 'short' | 'medium' | 'long'
