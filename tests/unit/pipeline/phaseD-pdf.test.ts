import { PDFDocument } from 'pdf-lib'
import { describe, expect, it } from 'vitest'

import type { Block, ParsedBook } from '@/parsers/types'
import { reconstructPdf } from '@/pipeline/phaseD-reconstruct/pdf-reflow'
import type {
  BookContext,
  MacroDecision,
  MicroDecision,
  NarrativeSpine,
  PhaseEvent,
  Section,
} from '@/pipeline/types'

import { makeClient } from './fixtures'

async function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof (blob as { arrayBuffer?: () => Promise<ArrayBuffer> }).arrayBuffer === 'function') {
    return blob.arrayBuffer()
  }
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'))
    reader.readAsArrayBuffer(blob)
  })
}

const SPINE: NarrativeSpine = {
  centralArgument: 'A book argues that things matter.',
  narrativeShape: 'Setup, complication, resolution.',
  recurringMotifs: ['motif-x', 'motif-y'],
  voiceAnchors: [
    'A voice anchor passage of more than thirty words that captures the register, rhythm, and texture of the author so the bracket-writer can mimic it.',
  ],
}

function makeBlock(opts: {
  id: string
  text: string
  pageNumber: number
  classification?: Block['classification']
}): Block {
  return {
    id: opts.id,
    text: opts.text,
    classification: opts.classification ?? 'body',
    pageNumber: opts.pageNumber,
  }
}

function makeSection(opts: {
  id: string
  order: number
  title: string
  pageStart: number
  pageEnd: number
  blocks: Block[]
}): Section {
  return {
    id: opts.id,
    order: opts.order,
    title: opts.title,
    startPage: opts.pageStart,
    endPage: opts.pageEnd,
    blocks: opts.blocks,
    rawText: opts.blocks
      .filter((b) => b.classification === 'body' || b.classification === 'protected')
      .map((b) => b.text)
      .join('\n\n'),
    summary: `Summary of ${opts.title}`,
    voiceSample:
      'A voice sample of more than thirty words for the section that captures the rhythm and register of the source author so we can mimic the tone of the prose.',
    source: 'fixed-window',
    confidence: 0.85,
  }
}

function buildFixture(): {
  parsedBook: ParsedBook
  sections: Section[]
  macroDecisions: MacroDecision[]
  microDecisions: MicroDecision[]
  ctx: BookContext
} {
  const sec1Blocks: Block[] = [
    makeBlock({ id: 's1-h', text: 'Running Head 1', pageNumber: 1, classification: 'header' }),
    makeBlock({
      id: 's1-b1',
      text: 'The first paragraph of the opening section. It introduces the setting and tone. The author writes with deliberate care.',
      pageNumber: 1,
    }),
    makeBlock({
      id: 's1-b2',
      text: 'A second paragraph, expanding on the introduction with concrete examples and at least one named figure such as Mao Zedong who lived through 1976.',
      pageNumber: 1,
    }),
    makeBlock({
      id: 's1-b3',
      text: 'A third paragraph closing out the opening section with a forward-looking sentence that gestures at what is to come.',
      pageNumber: 2,
    }),
    makeBlock({
      id: 's1-folio',
      text: '1',
      pageNumber: 1,
      classification: 'folio',
    }),
  ]
  const sec2Blocks: Block[] = [
    makeBlock({
      id: 's2-b1',
      text: 'This section is the long digression. It is full of background context that does not advance the central argument.',
      pageNumber: 3,
    }),
    makeBlock({
      id: 's2-b2',
      text: 'A second paragraph of digression material, with named places like Sichuan and Henan and dates such as 1959.',
      pageNumber: 4,
    }),
    makeBlock({
      id: 's2-b3',
      text: 'A third paragraph of digression material, continuing in the same vein, with anecdotes and asides.',
      pageNumber: 5,
    }),
    makeBlock({
      id: 's2-fn',
      text: '1. A footnote with citation.',
      pageNumber: 5,
      classification: 'footnote',
    }),
  ]
  const sec3Blocks: Block[] = [
    makeBlock({
      id: 's3-b1',
      text: 'The closing section begins. It returns to the original argument and brings it to a head.',
      pageNumber: 6,
    }),
    makeBlock({
      id: 's3-b2',
      text: 'A second paragraph of the closing section. It draws conclusions and gestures at implications.',
      pageNumber: 7,
    }),
    makeBlock({
      id: 's3-cap',
      text: 'Figure 1: a caption that should still be rendered.',
      pageNumber: 7,
      classification: 'caption',
    }),
    makeBlock({
      id: 's3-b3',
      text: 'A final paragraph that closes the book on a quiet, reflective note for the reader.',
      pageNumber: 8,
    }),
    makeBlock({
      id: 's3-prot',
      text: 'verbatim_code_block: do_not_alter()',
      pageNumber: 9,
      classification: 'protected',
    }),
    makeBlock({
      id: 's3-b4',
      text: 'A coda paragraph after the protected block, used as the very last paragraph of the section.',
      pageNumber: 10,
    }),
  ]

  const sections: Section[] = [
    makeSection({
      id: 'sec-1',
      order: 1,
      title: 'Chapter 1: Opening',
      pageStart: 1,
      pageEnd: 2,
      blocks: sec1Blocks,
    }),
    makeSection({
      id: 'sec-2',
      order: 2,
      title: 'Chapter 2: A Digression',
      pageStart: 3,
      pageEnd: 5,
      blocks: sec2Blocks,
    }),
    makeSection({
      id: 'sec-3',
      order: 3,
      title: 'Chapter 3: The Close',
      pageStart: 6,
      pageEnd: 10,
      blocks: sec3Blocks,
    }),
  ]

  const pages = Array.from({ length: 10 }, (_, i) => ({
    number: i + 1,
    blocks: [...sec1Blocks, ...sec2Blocks, ...sec3Blocks].filter((b) => b.pageNumber === i + 1),
  }))

  const parsedBook: ParsedBook = {
    id: 'pdf-fixture',
    format: 'pdf',
    title: 'A Test Book',
    author: 'A. Tester',
    pages,
    rawText: sections.map((s) => s.rawText).join('\n\n'),
    matter: { detected: [] },
    warnings: [],
  }

  const macroDecisions: MacroDecision[] = [
    {
      sectionId: 'sec-1',
      verdict: 'KEEP_PARTIAL',
      rationale: 'keep the opening; trim background',
      forwardDependencies: [],
      backwardDependencies: [],
      confidence: 0.8,
    },
    {
      sectionId: 'sec-2',
      verdict: 'COMPRESS_TO_BRACKET',
      rationale: 'digression — compress to bracket',
      forwardDependencies: [],
      backwardDependencies: [],
      bracketLengthHint: 'short',
      confidence: 0.9,
    },
    {
      sectionId: 'sec-3',
      verdict: 'KEEP_FULL',
      rationale: 'closing chapter, keep entirely',
      forwardDependencies: [],
      backwardDependencies: [],
      confidence: 0.95,
    },
  ]
  const microDecisions: MicroDecision[] = [
    {
      sectionId: 'sec-1',
      deletions: [
        {
          startOffset: 0,
          endOffset: 100,
          containedBlockIds: ['s1-b2'],
          dropRationale: 'cut the second paragraph',
          bracketLengthHint: 'short',
        },
      ],
      rejectedDeletions: [],
    },
    {
      sectionId: 'sec-3',
      deletions: [
        {
          startOffset: 0,
          endOffset: 80,
          containedBlockIds: ['s3-b2'],
          dropRationale: 'cut the middle conclusion paragraph',
          bracketLengthHint: 'one-line',
        },
      ],
      rejectedDeletions: [],
    },
  ]

  const ctx: BookContext = {
    purpose: 'understand how the test book builds an argument',
    spine: SPINE,
    canonicalPassages: [],
    allSectionSummaries: sections.map((s) => ({
      id: s.id,
      title: s.title,
      order: s.order,
      summary: s.summary,
      signals: s.signals,
    })),
  }

  return { parsedBook, sections, macroDecisions, microDecisions, ctx }
}

describe('reconstructPdf', () => {
  it('produces a valid abridged PDF blob with bracket entries and correct stats', async () => {
    const { parsedBook, sections, macroDecisions, microDecisions, ctx } = buildFixture()
    const client = makeClient()
    const mock = client.useMockProvider()
    mock.setDefaultResponse({
      text: JSON.stringify({ bracketText: 'BRACKET_PDF_PLACEHOLDER' }),
      promptTokens: 100,
      completionTokens: 50,
    })

    const events: PhaseEvent[] = []
    const result = await reconstructPdf(
      { parsedBook, sections, macroDecisions, microDecisions, ctx, client },
      {
        bracketConcurrency: 2,
        emit: (event) => {
          events.push(event)
        },
      },
    )

    // Blob is an application/pdf blob.
    expect(result.abridgedBlob.type).toBe('application/pdf')
    expect(result.abridgedBlob.size).toBeGreaterThan(0)

    // pdf-lib parses it successfully.
    const buffer = await blobToArrayBuffer(result.abridgedBlob)
    const doc = await PDFDocument.load(buffer)
    const pageCount = doc.getPageCount()
    expect(pageCount).toBeGreaterThanOrEqual(2) // at least cover + body
    expect(doc.getTitle()).toBe('A Test Book')

    // Stats.
    expect(result.stats.originalPages).toBe(parsedBook.pages.length)
    expect(result.stats.originalPages).toBeGreaterThan(result.stats.abridgedPages)
    expect(result.stats.sectionsBracketed).toBe(1)
    expect(result.stats.sectionsKept).toBe(2)
    expect(result.stats.microCuts).toBe(2)

    // Bracket entries: one macro for sec-2, one micro for sec-1, one micro for sec-3.
    expect(result.bracketTexts).toHaveLength(3)
    const macroBracket = result.bracketTexts.find(
      (b) => b.sectionId === 'sec-2' && b.deletionIndex === -1,
    )
    expect(macroBracket).toBeDefined()
    expect(macroBracket?.bracketText).toContain('BRACKET_PDF_PLACEHOLDER')

    const sec1Micro = result.bracketTexts.filter((b) => b.sectionId === 'sec-1')
    expect(sec1Micro).toHaveLength(1)
    expect(sec1Micro[0].deletionIndex).toBe(0)

    const sec3Micro = result.bracketTexts.filter((b) => b.sectionId === 'sec-3')
    expect(sec3Micro).toHaveLength(1)
    expect(sec3Micro[0].deletionIndex).toBe(0)

    // Sections with KEEP_* get no macro brackets.
    expect(
      result.bracketTexts.some(
        (b) => (b.sectionId === 'sec-1' || b.sectionId === 'sec-3') && b.deletionIndex === -1,
      ),
    ).toBe(false)

    // Emit lifecycle.
    expect(events[0]).toMatchObject({ kind: 'phase-start', phase: 'D-pdf' })
    expect(events[events.length - 1]).toMatchObject({ kind: 'phase-end', phase: 'D-pdf' })
    expect(events.some((e) => e.kind === 'phase-progress')).toBe(true)
  }, 30000)

  it('throws when parsedBook is not a PDF', async () => {
    const client = makeClient()
    client.useMockProvider()
    await expect(
      reconstructPdf({
        parsedBook: {
          id: 'x',
          format: 'epub',
          pages: [],
          rawText: '',
          matter: { detected: [] },
          warnings: [],
        },
        sections: [],
        macroDecisions: [],
        microDecisions: [],
        ctx: {
          purpose: 'test',
          spine: SPINE,
          canonicalPassages: [],
          allSectionSummaries: [],
        },
        client,
      }),
    ).rejects.toThrow(/pdf/i)
  })

  it('matches macro deletions with deletionIndex -1 and micro deletions with index 0+', async () => {
    const { parsedBook, sections, macroDecisions, microDecisions, ctx } = buildFixture()
    const client = makeClient()
    const mock = client.useMockProvider()
    mock.setDefaultResponse({
      text: JSON.stringify({ bracketText: 'IDX_TEST' }),
      promptTokens: 50,
      completionTokens: 25,
    })

    const result = await reconstructPdf(
      { parsedBook, sections, macroDecisions, microDecisions, ctx, client },
      { bracketConcurrency: 1 },
    )

    const macros = result.bracketTexts.filter((b) => b.deletionIndex === -1)
    const micros = result.bracketTexts.filter((b) => b.deletionIndex >= 0)
    expect(macros).toHaveLength(1)
    expect(macros[0].sectionId).toBe('sec-2')
    expect(micros.every((b) => b.deletionIndex >= 0)).toBe(true)
    expect(micros).toHaveLength(2)
  }, 30000)
})
