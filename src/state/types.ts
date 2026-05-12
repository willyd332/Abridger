import type { ParsedBook, BookFormat } from '@/parsers/types'
import type {
  CanonicalPassage,
  MacroDecision,
  MicroDecision,
  NarrativeSpine,
  PhaseEvent,
  Section,
} from '@/pipeline/types'
import type { CostCeiling, Provider, Role } from '@/llm/types'

export type RunStatus = 'in_progress' | 'paused' | 'done' | 'cancelled' | 'errored'

export type RouteName = 'short-book' | 'normal-book' | 'long-book' | 'no-chapter-book'

export type FrontBackMatterHandling = 'keep' | 'abridge' | 'drop'

export type PhaseStatusKind = 'pending' | 'in_flight' | 'done' | 'error' | 'skipped'

export type PhaseStatus = {
  status: PhaseStatusKind
  attempts: number
  lastError?: string
  requestId?: string
  requestStartedAt?: number
  completedAt?: number
  costBilled?: number
}

export type PhaseName = 'A' | 'A5' | 'B' | 'B5' | 'C1' | 'C15' | 'C2' | 'D'

export type SectionPhaseStatus = Record<PhaseName, PhaseStatus>

export type ModelMapping = Record<Role, string>

export type PromptHashes = Record<string, string>

export type RunRecord = {
  runId: string
  createdAt: number
  updatedAt: number
  status: RunStatus
  phase: string
  route: RouteName | null
  bookId: string
  purpose: string
  provider: Provider
  modelMapping: ModelMapping
  promptHashes: PromptHashes
  cost: CostCeiling
  storeKeyLocally: boolean
  frontBackMatterHandling: FrontBackMatterHandling
}

export type NewRun = Omit<RunRecord, 'createdAt' | 'updatedAt'> & {
  createdAt?: number
  updatedAt?: number
}

export type BookRecord = {
  bookId: string
  runId: string
  format: BookFormat
  originalFileName: string
  originalFileSize: number
  parsed: ParsedBook
  originalBlob: Blob
}

export type SectionRecord = {
  runId: string
  sectionId: string
  order: number
  section: Section
  phaseStatus: SectionPhaseStatus
  macroDecision?: MacroDecision
  microDecision?: MicroDecision
}

export type SpineRecord = {
  runId: string
  spine: NarrativeSpine
  canonicalPassages: CanonicalPassage[]
}

export type BracketKind = 'micro' | 'whole-section'

export type BracketRecord = {
  runId: string
  sectionId: string
  deletionIndex: number
  bracketText: string
  producedAt: number
  model: string
}

export type OutputKind = 'abridged-pdf' | 'abridged-epub' | 'ledger-md'

export type OutputRecord = {
  runId: string
  kind: OutputKind
  mimeType: string
  blob: Blob
  producedAt: number
}

export type EventRecord = {
  id?: number
  runId: string
  timestamp: number
  event: PhaseEvent
}

export const PHASE_NAMES: ReadonlyArray<PhaseName> = [
  'A',
  'A5',
  'B',
  'B5',
  'C1',
  'C15',
  'C2',
  'D',
]

export function defaultPhaseStatus(): PhaseStatus {
  return {
    status: 'pending',
    attempts: 0,
  }
}

export function defaultSectionPhaseStatus(): SectionPhaseStatus {
  return PHASE_NAMES.reduce<SectionPhaseStatus>((acc, name) => {
    return { ...acc, [name]: defaultPhaseStatus() }
  }, {} as SectionPhaseStatus)
}
