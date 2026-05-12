import type { ParsedBook } from '@/parsers/types'
import type { Section, NarrativeSpine } from '@/pipeline/types'
import type {
  BookRecord,
  BracketRecord,
  EventRecord,
  OutputRecord,
  RunRecord,
  SectionRecord,
  SpineRecord,
} from '@/state/types'
import { defaultSectionPhaseStatus } from '@/state/types'

let counter = 0
function nextOrder(): number {
  counter += 1
  return counter
}

export function makeRunRecord(overrides: Partial<RunRecord> = {}): RunRecord {
  const ts = Date.now() + nextOrder()
  return {
    runId: 'r-default',
    createdAt: ts,
    updatedAt: ts,
    status: 'in_progress',
    phase: 'A',
    route: null,
    bookId: 'b-default',
    purpose: 'test purpose',
    provider: 'anthropic',
    modelMapping: {
      cheap: 'claude-haiku-4-5-20251001',
      smart: 'claude-sonnet-4-6',
      reasoning: 'claude-opus-4-7',
    },
    promptHashes: {},
    cost: { ceilingUsd: 5, reservedUsd: 0, billedUsd: 0 },
    storeKeyLocally: false,
    frontBackMatterHandling: 'abridge',
    ...overrides,
  }
}

const STUB_PARSED_BOOK: ParsedBook = {
  id: 'stub-book',
  format: 'pdf',
  pages: [],
  rawText: '',
  matter: { detected: [] },
  warnings: [],
}

export function makeBookRecord(overrides: Partial<BookRecord> & { blob?: Blob } = {}): BookRecord {
  const blob = overrides.blob ?? new Blob(['stub'], { type: 'application/pdf' })
  const { blob: _, ...rest } = overrides
  void _
  return {
    bookId: 'b-default',
    runId: 'r-default',
    format: 'pdf',
    originalFileName: 'book.pdf',
    originalFileSize: blob.size,
    parsed: STUB_PARSED_BOOK,
    originalBlob: blob,
    ...rest,
  }
}

const STUB_SECTION: Section = {
  id: 's-default',
  order: 1,
  title: 'Section',
  startPage: 1,
  endPage: 1,
  blocks: [],
  rawText: 'Stub section text.',
  source: 'llm-detected',
  confidence: 0.8,
}

export function makeSectionRecord(
  overrides: Partial<SectionRecord> & { sectionId?: string } = {},
): SectionRecord {
  const sectionId = overrides.sectionId ?? 's-default'
  const section: Section = {
    ...STUB_SECTION,
    id: sectionId,
    order: overrides.order ?? 1,
  }
  return {
    runId: 'r-default',
    sectionId,
    order: section.order,
    section,
    phaseStatus: defaultSectionPhaseStatus(),
    ...overrides,
  }
}

const STUB_SPINE: NarrativeSpine = {
  centralArgument: 'Central Argument for tests.',
  narrativeShape: 'arc',
  recurringMotifs: ['motif-a'],
  voiceAnchors: ['voice-a'],
}

export function makeSpineRecord(overrides: Partial<SpineRecord> = {}): SpineRecord {
  return {
    runId: 'r-default',
    spine: STUB_SPINE,
    canonicalPassages: [],
    ...overrides,
  }
}

export function makeBracketRecord(overrides: Partial<BracketRecord> = {}): BracketRecord {
  return {
    runId: 'r-default',
    sectionId: 's-default',
    deletionIndex: 0,
    bracketText: 'bracket text',
    producedAt: Date.now(),
    model: 'claude-sonnet-4-6',
    ...overrides,
  }
}

export function makeOutputRecord(
  overrides: Partial<OutputRecord> & { blob?: Blob } = {},
): OutputRecord {
  const blob = overrides.blob ?? new Blob(['out'], { type: 'application/pdf' })
  const { blob: _, ...rest } = overrides
  void _
  return {
    runId: 'r-default',
    kind: 'abridged-pdf',
    mimeType: blob.type || 'application/octet-stream',
    blob,
    producedAt: Date.now(),
    ...rest,
  }
}

export function makeEventRecord(args: {
  runId: string
  timestamp: number
  phase: string
}): Omit<EventRecord, 'id'> {
  return {
    runId: args.runId,
    timestamp: args.timestamp,
    event: { kind: 'phase-start', phase: args.phase },
  }
}
