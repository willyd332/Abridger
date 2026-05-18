import type { ParsedBook, BookFormat } from '@/parsers/types'
import type {
  NarrativeSpine,
  PhaseEvent,
  Section,
} from '@/pipeline/types'
import type {
  NodeDependencies,
  OntologyTree,
} from '@/pipeline/ontology/types'
import type { CostCeiling, Provider, Role } from '@/llm/types'

export type RunStatus = 'in_progress' | 'paused' | 'done' | 'cancelled' | 'errored'

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

export type PhaseName = 'A' | 'A5' | 'O' | 'S-leaf' | 'S-internal'

export type SectionPhaseStatus = Record<PhaseName, PhaseStatus>

export type ModelMapping = Record<Role, string>

export type PromptHashes = Record<string, string>

export type RunRecord = {
  runId: string
  createdAt: number
  updatedAt: number
  status: RunStatus
  phase: string
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
  // PDF only — first original-PDF page treated as "page 1" of the book
  // content. Pages 1..(startPage-1) of the originalBlob are preamble:
  // excluded from analysis, re-attached verbatim at the start of the
  // exported PDF. Undefined or 1 means analyze everything.
  startPage?: number
}

export type SectionRecord = {
  runId: string
  sectionId: string
  order: number
  section: Section
  phaseStatus: SectionPhaseStatus
}

export type SpineRecord = {
  runId: string
  spine: NarrativeSpine
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

export type OntologyRecord = {
  runId: string
  tree: OntologyTree
  storedAt: number
}

export type InclusionRecord = {
  runId: string
  inclusion: Record<string, boolean>
  updatedAt: number
}

export type DependenciesRecord = {
  runId: string
  nodeId: string
  result: NodeDependencies
}

export const PHASE_NAMES: ReadonlyArray<PhaseName> = [
  'A',
  'A5',
  'O',
  'S-leaf',
  'S-internal',
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
