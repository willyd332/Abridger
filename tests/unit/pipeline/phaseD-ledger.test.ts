import { describe, expect, it } from 'vitest'

import { buildLedger, type LedgerInput } from '@/pipeline/phaseD-reconstruct/ledger'
import type {
  CanonicalPassage,
  MacroDecision,
  MicroDecision,
  NarrativeSpine,
  Section,
} from '@/pipeline/types'
import type { ParsedBook } from '@/parsers/types'

function makeSection(opts: {
  id: string
  order: number
  title: string
  rawText: string
  startPage?: number
  endPage?: number
}): Section {
  return {
    id: opts.id,
    order: opts.order,
    title: opts.title,
    startPage: opts.startPage ?? opts.order,
    endPage: opts.endPage ?? opts.order,
    blocks: [],
    rawText: opts.rawText,
    summary: `Summary for ${opts.title}.`,
    signals: {
      isCore: false,
      hasFamousArgument: false,
      narrativeFunction: 'argument',
      density: 'medium',
    },
    voiceSample: 'voice sample',
    source: 'llm-detected',
    confidence: 0.9,
  }
}

const SPINE: NarrativeSpine = {
  centralArgument: 'The book argues that abridgement is craft.',
  narrativeShape: 'It opens with theory, builds with examples, lands with practice.',
  recurringMotifs: ['craft', 'voice', 'asymmetric loss'],
  voiceAnchors: ['Anchor passage long enough to feel like the author speaking out loud across the page.'],
}

const CANONICAL: CanonicalPassage[] = [
  {
    description: 'The opening hymn to ink',
    pageOrSectionRef: 'Section 1',
    validated: true,
    matchedSnippet: 'Ink, that black blood of letters,',
  },
]

const SECTIONS: Section[] = [
  makeSection({
    id: 'sec-001',
    order: 1,
    title: 'The Opening',
    rawText: 'A'.repeat(1000),
  }),
  makeSection({
    id: 'sec-002',
    order: 2,
    title: 'The Middle',
    rawText: 'B'.repeat(2000),
  }),
  makeSection({
    id: 'sec-003',
    order: 3,
    title: 'A Digression',
    rawText: 'C'.repeat(500),
  }),
]

const MACRO_DECISIONS: MacroDecision[] = [
  {
    sectionId: 'sec-001',
    verdict: 'KEEP_FULL',
    rationale: 'Sets up the central argument and must remain intact.',
    forwardDependencies: ['sec-002'],
    backwardDependencies: [],
    confidence: 0.95,
  },
  {
    sectionId: 'sec-002',
    verdict: 'KEEP_PARTIAL',
    rationale: 'Core material with some compressible asides.',
    forwardDependencies: [],
    backwardDependencies: ['sec-001'],
    confidence: 0.8,
  },
  {
    sectionId: 'sec-003',
    verdict: 'DROP_TO_ONE_LINE',
    rationale: 'Off-topic digression with no callbacks elsewhere.',
    forwardDependencies: [],
    backwardDependencies: [],
    bracketLengthHint: 'one-line',
    confidence: 0.7,
  },
]

const MICRO_DECISIONS: MicroDecision[] = [
  {
    sectionId: 'sec-001',
    deletions: [],
    rejectedDeletions: [],
  },
  {
    sectionId: 'sec-002',
    deletions: [
      {
        startOffset: 200,
        endOffset: 400,
        containedBlockIds: ['2-1', '2-2'],
        dropRationale: 'Tangential anecdote about the author’s neighbour.',
        bracketLengthHint: 'short',
      },
      {
        startOffset: 800,
        endOffset: 1200,
        containedBlockIds: ['2-5'],
        dropRationale: 'Repeated argument already made in section 1.',
        bracketLengthHint: 'medium',
      },
    ],
    rejectedDeletions: [],
  },
]

const BRACKETS = [
  {
    sectionId: 'sec-002',
    deletionIndex: 0,
    bracketText: 'X'.repeat(80),
  },
  {
    sectionId: 'sec-002',
    deletionIndex: 1,
    bracketText: 'Y'.repeat(160),
  },
  {
    sectionId: 'sec-003',
    deletionIndex: -1,
    bracketText: 'Z'.repeat(40),
  },
]

const PARSED_BOOK: ParsedBook = {
  id: 'book-1',
  format: 'pdf',
  title: 'The Test Book',
  author: 'Test Author',
  pages: [
    { number: 1, blocks: [] },
    { number: 2, blocks: [] },
    { number: 3, blocks: [] },
  ],
  rawText: 'A'.repeat(1000) + 'B'.repeat(2000) + 'C'.repeat(500),
  matter: { detected: [] },
  warnings: [],
}

function makeInput(overrides: Partial<LedgerInput> = {}): LedgerInput {
  return {
    parsedBook: PARSED_BOOK,
    sections: SECTIONS,
    macroDecisions: MACRO_DECISIONS,
    microDecisions: MICRO_DECISIONS,
    spine: SPINE,
    canonicalPassages: CANONICAL,
    brackets: BRACKETS,
    runId: 'run-12345678-abcd-efgh-ijkl',
    startedAt: Date.UTC(2026, 4, 12, 14, 30),
    finishedAt: Date.UTC(2026, 4, 12, 14, 45),
    modelMapping: {
      cheap: 'claude-haiku-4-5',
      smart: 'claude-sonnet-4-6',
      reasoning: 'claude-opus-4-7',
    },
    promptHashes: {
      structure: 'abcdef0123456789feedfacecafebabe',
      'macro-filter': '0123456789abcdef0123456789abcdef',
      'bracket-writer': 'fedcba9876543210fedcba9876543210',
    },
    totalCostUsd: 2.45,
    purpose: 'Learn the craft of abridgement',
    originalFileName: 'the-test-book.pdf',
    ...overrides,
  }
}

describe('buildLedger', () => {
  it('emits markdown containing every section title and standard headers', () => {
    const result = buildLedger(makeInput())
    expect(result.markdown).toContain('# Abridgement Ledger')
    expect(result.markdown).toContain('## Summary')
    expect(result.markdown).toContain('## Models & prompts')
    expect(result.markdown).toContain('## Narrative spine')
    expect(result.markdown).toContain('## Canonical passages preserved')
    expect(result.markdown).toContain('## Section-by-section ledger')
    expect(result.markdown).toContain('The Opening')
    expect(result.markdown).toContain('The Middle')
    expect(result.markdown).toContain('A Digression')
  })

  it('computes stats accurately from the fixture', () => {
    const result = buildLedger(makeInput())
    // Original: 1000 + 2000 + 500 = 3500
    expect(result.stats.originalLengthChars).toBe(3500)
    // sec-001 kept full = 1000 chars, 0 deletions, 0 brackets
    // sec-002 KEEP_PARTIAL = 2000 - (200 + 400) + (80 + 160) = 1640
    // sec-003 DROP = whole-section bracket = 40
    // Total abridged = 1000 + 1640 + 40 = 2680
    expect(result.stats.abridgedLengthChars).toBe(2680)
    // (1 - 2680/3500) * 100 = 23.428...% → 23.4
    expect(result.stats.reductionPercent).toBeCloseTo(23.4, 1)
    expect(result.stats.sectionsKeptFull).toBe(1)
    expect(result.stats.sectionsKeptPartial).toBe(1)
    expect(result.stats.sectionsCompressed).toBe(0)
    expect(result.stats.sectionsDropped).toBe(1)
    expect(result.stats.microCutsTotal).toBe(2)
    expect(result.stats.bracketsTotal).toBe(3)
  })

  it('renders verdicts and bracket text for each section', () => {
    const md = buildLedger(makeInput()).markdown
    expect(md).toContain('**Verdict:** KEEP FULL')
    expect(md).toContain('**Verdict:** KEEP PARTIAL')
    expect(md).toContain('**Verdict:** DROP TO ONE LINE')
    expect(md).toContain('Cut #1')
    expect(md).toContain('Cut #2')
    expect(md).toContain('Replacement bracket:')
    expect(md).toContain('Z'.repeat(40))
  })

  it('sanitizes the filename from the book title', () => {
    const result = buildLedger(makeInput())
    expect(result.filename).toBe('the-test-book-abridgement-ledger.md')
  })

  it('falls back to the original filename when title is missing', () => {
    const result = buildLedger(
      makeInput({
        parsedBook: { ...PARSED_BOOK, title: undefined },
        originalFileName: 'Strange   Name!! v2.epub',
      }),
    )
    expect(result.filename).toBe('strange-name-v2-abridgement-ledger.md')
  })

  it('falls back to runId when neither title nor filename is usable', () => {
    const result = buildLedger(
      makeInput({
        parsedBook: { ...PARSED_BOOK, title: '   ' },
        originalFileName: '!!! .pdf',
        runId: 'run-12345678-abcd',
      }),
    )
    expect(result.filename).toBe('abridgement-ledger-run12345.md')
  })

  it('caps filename length at 80 characters', () => {
    const longTitle = 'A '.repeat(200) + 'Very Long Title'
    const result = buildLedger(
      makeInput({ parsedBook: { ...PARSED_BOOK, title: longTitle } }),
    )
    expect(result.filename.length).toBeLessThanOrEqual(80)
    expect(result.filename.endsWith('-abridgement-ledger.md')).toBe(true)
  })

  it('produces a markdown Blob whose length matches the markdown string', () => {
    const result = buildLedger(makeInput())
    expect(result.blob.type).toBe('text/markdown')
    expect(result.blob.size).toBe(new TextEncoder().encode(result.markdown).length)
  })

  it('renders an empty-state for an empty canonical passages list', () => {
    const result = buildLedger(makeInput({ canonicalPassages: [] }))
    expect(result.markdown).toContain('No canonical passages identified.')
  })

  it('escapes markdown control characters in the purpose so output remains valid', () => {
    const result = buildLedger(
      makeInput({ purpose: 'Look at `code` and *emphasis* and _italic_' }),
    )
    expect(result.markdown).toContain('\\`code\\`')
    expect(result.markdown).toContain('\\*emphasis\\*')
    expect(result.markdown).toContain('\\_italic\\_')
  })

  it('lists prompt hashes truncated to first 12 chars', () => {
    const md = buildLedger(makeInput()).markdown
    expect(md).toContain('abcdef012345')
    expect(md).not.toContain('abcdef0123456789')
  })

  it('renders model mapping rows for every role', () => {
    const md = buildLedger(makeInput()).markdown
    expect(md).toContain('| cheap | claude-haiku-4-5 |')
    expect(md).toContain('| smart | claude-sonnet-4-6 |')
    expect(md).toContain('| reasoning | claude-opus-4-7 |')
  })

  it('marks "(Kept verbatim.)" for sections with no micro deletions', () => {
    const md = buildLedger(makeInput()).markdown
    expect(md).toContain('(Kept verbatim.)')
  })

  it('handles empty sections gracefully', () => {
    const result = buildLedger(
      makeInput({
        sections: [],
        macroDecisions: [],
        microDecisions: [],
        brackets: [],
        parsedBook: { ...PARSED_BOOK, rawText: '' },
      }),
    )
    expect(result.markdown).toContain('_No sections recorded for this run._')
    expect(result.stats.originalLengthChars).toBe(0)
    expect(result.stats.reductionPercent).toBe(0)
  })
})
