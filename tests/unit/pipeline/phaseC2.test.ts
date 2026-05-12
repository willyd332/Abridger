import { describe, expect, it } from 'vitest'

import type { Block } from '@/parsers/types'
import { phaseC2Micro } from '@/pipeline/phaseC2-micro'
import type {
  BookContext,
  MacroDecision,
  MacroVerdict,
  NarrativeSpine,
  Section,
} from '@/pipeline/types'

import { makeClient } from './fixtures'

const SPINE: NarrativeSpine = {
  centralArgument: 'A test argument.',
  narrativeShape: 'It opens, develops, lands.',
  recurringMotifs: ['motif a', 'motif b'],
  voiceAnchors: ['anchor passage of more than thirty words to satisfy the spine schema downstream of B5.'],
}

function makeCtx(sections: Section[]): BookContext {
  return {
    purpose: 'understand the test argument',
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
  order: number
  blocks: Block[]
  id?: string
  title?: string
}): Section {
  const rawText = opts.blocks
    .filter((b) => b.classification !== 'header' && b.classification !== 'folio' && b.classification !== 'footer')
    .map((b) => b.text)
    .join('\n\n')
  return {
    id: opts.id ?? `sec-${String(opts.order).padStart(3, '0')}`,
    order: opts.order,
    title: opts.title ?? `Section ${opts.order}`,
    startPage: 1,
    endPage: 1,
    blocks: opts.blocks,
    rawText,
    summary: 'Summary',
    signals: {
      isCore: true,
      hasFamousArgument: false,
      narrativeFunction: 'argument',
      density: 'medium',
    },
    voiceSample: 'voice sample',
    source: 'llm-detected',
    confidence: 0.8,
  }
}

function makeDecision(id: string, verdict: MacroVerdict): MacroDecision {
  return {
    sectionId: id,
    verdict,
    rationale: 'r',
    forwardDependencies: [],
    backwardDependencies: [],
    confidence: 0.8,
  }
}

describe('phaseC2Micro', () => {
  it('returns deletions for KEEP_* sections and ignores COMPRESS/DROP', async () => {
    const sectionKeep = makeSection({
      order: 1,
      blocks: [
        makeBlock({ id: '1-0', text: 'Alpha paragraph one. With multiple sentences.', pageNumber: 1 }),
        makeBlock({ id: '1-1', text: 'Beta paragraph two. With more material.', pageNumber: 1 }),
      ],
    })
    const sectionDrop = makeSection({
      order: 2,
      blocks: [makeBlock({ id: '2-0', text: 'Gamma section that will be dropped.', pageNumber: 2 })],
    })
    const sections = [sectionKeep, sectionDrop]
    const decisions: MacroDecision[] = [
      makeDecision(sectionKeep.id, 'KEEP_PARTIAL'),
      makeDecision(sectionDrop.id, 'COMPRESS_TO_BRACKET'),
    ]
    const ctx = makeCtx(sections)
    const client = makeClient()
    const mock = client.useMockProvider()
    // The section has rawText "Alpha paragraph one. With multiple sentences.\n\nBeta paragraph two. With more material."
    // Choose a deletion that begins at offset 0 (start of section) and ends at the period after "sentences." (offset 44).
    const fullText = 'Alpha paragraph one. With multiple sentences.\n\nBeta paragraph two. With more material.'
    expect(fullText.slice(0, 44)).toBe('Alpha paragraph one. With multiple sentences')
    mock.setDefaultResponse({
      text: JSON.stringify({
        deletions: [
          {
            startOffset: 0,
            endOffset: 45,
            dropRationale: 'low-yield opener',
            bracketLengthHint: 'short',
          },
        ],
      }),
      promptTokens: 50,
      completionTokens: 50,
    })
    const results = await phaseC2Micro(sections, decisions, ctx, client)
    expect(results).toHaveLength(1)
    expect(results[0].sectionId).toBe(sectionKeep.id)
    expect(results[0].deletions).toHaveLength(1)
    expect(results[0].deletions[0].startOffset).toBe(0)
    expect(results[0].deletions[0].endOffset).toBe(45)
    expect(mock.callCount()).toBe(1)
    // Only one call total; that call's metadata.sectionId is the KEEP section's id.
    const history = mock.history()
    expect(history[0].opts.metadata.sectionId).toBe(sectionKeep.id)
  })

  it('rejects deletions that intersect a protected block', async () => {
    const blocks = [
      makeBlock({ id: '1-0', text: 'Opening prose. With a second sentence here.', pageNumber: 1 }),
      makeBlock({ id: '1-1', text: 'def f():\n    return 1', pageNumber: 1, classification: 'protected' }),
      makeBlock({ id: '1-2', text: 'Closing prose. With another sentence.', pageNumber: 1 }),
    ]
    const section = makeSection({ order: 1, blocks })
    const sections = [section]
    const decisions = [makeDecision(section.id, 'KEEP_PARTIAL')]
    const ctx = makeCtx(sections)
    const client = makeClient()
    const mock = client.useMockProvider()
    // The annotated text has the protected fence; deliberately propose a range
    // that starts in plain prose but ends inside the protected block.
    mock.setDefaultResponse({
      text: JSON.stringify({
        deletions: [
          {
            startOffset: 0,
            endOffset: 80,
            dropRationale: 'spans into protected',
            bracketLengthHint: 'short',
          },
        ],
      }),
      promptTokens: 50,
      completionTokens: 50,
    })
    const results = await phaseC2Micro(sections, decisions, ctx, client)
    expect(results[0].deletions).toHaveLength(0)
    expect(results[0].rejectedDeletions).toHaveLength(1)
    expect(results[0].rejectedDeletions[0].reason).toBe('crosses-protected-block')
  })

  it('rejects deletions that span multiple paragraphs', async () => {
    const section = makeSection({
      order: 1,
      blocks: [
        makeBlock({ id: '1-0', text: 'First paragraph. With two sentences here.', pageNumber: 1 }),
        makeBlock({ id: '1-1', text: 'Second paragraph. With its own sentences.', pageNumber: 1 }),
      ],
    })
    const sections = [section]
    const decisions = [makeDecision(section.id, 'KEEP_PARTIAL')]
    const ctx = makeCtx(sections)
    const client = makeClient()
    const mock = client.useMockProvider()
    // rawText = "First paragraph. With two sentences here.\n\nSecond paragraph. With its own sentences."
    const fullText = section.rawText
    expect(fullText.includes('\n\n')).toBe(true)
    mock.setDefaultResponse({
      text: JSON.stringify({
        deletions: [
          {
            startOffset: 0,
            endOffset: fullText.length,
            dropRationale: 'span both paragraphs',
            bracketLengthHint: 'short',
          },
        ],
      }),
      promptTokens: 50,
      completionTokens: 50,
    })
    const results = await phaseC2Micro(sections, decisions, ctx, client)
    expect(results[0].deletions).toHaveLength(0)
    expect(results[0].rejectedDeletions).toHaveLength(1)
    expect(results[0].rejectedDeletions[0].reason).toBe('spans-multiple-paragraphs')
  })

  it('snaps to sentence boundary within 40 chars; rejects when farther', async () => {
    const section = makeSection({
      order: 1,
      blocks: [
        makeBlock({
          id: '1-0',
          text: 'First sentence here. Second sentence is somewhat longer than the first. Third short.',
          pageNumber: 1,
        }),
      ],
    })
    const sections = [section]
    const decisions = [makeDecision(section.id, 'KEEP_PARTIAL')]
    const ctx = makeCtx(sections)
    const client = makeClient()
    const mock = client.useMockProvider()
    // rawText = "First sentence here. Second sentence is somewhat longer than the first. Third short."
    // Sentence boundaries (period+space): 19 (after "here."), 71 (after "first.")
    // Propose [start=0, end=15] — mid-word, within 40 chars of 19 — should snap to 20 (after the space).
    // For snap-success, we test endOffset close to 19. Start at 0 (boundary). End at 15 should snap to 19 or 20.
    mock.setDefaultResponse({
      text: JSON.stringify({
        deletions: [
          {
            startOffset: 0,
            endOffset: 15,
            dropRationale: 'snap-test close',
            bracketLengthHint: 'short',
          },
        ],
      }),
      promptTokens: 50,
      completionTokens: 50,
    })
    const closeResults = await phaseC2Micro(sections, decisions, ctx, client)
    expect(closeResults[0].deletions).toHaveLength(1)
    const snapped = closeResults[0].deletions[0]
    // Should snap to either position 19 (the period) or 20 (right after the space).
    expect([19, 20]).toContain(snapped.endOffset)

    // Now propose an endOffset deep inside a long stretch with no nearby boundary — should reject.
    const longSection = makeSection({
      order: 2,
      blocks: [
        makeBlock({
          id: '2-0',
          text:
            'Begin. ' +
            'word '.repeat(20) + // ~100 chars with no internal sentence boundary
            'End. Trailing sentence.',
          pageNumber: 2,
        }),
      ],
    })
    const longSections = [longSection]
    const longDecisions = [makeDecision(longSection.id, 'KEEP_PARTIAL')]
    const longCtx = makeCtx(longSections)
    const longClient = makeClient()
    const longMock = longClient.useMockProvider()
    longMock.setDefaultResponse({
      text: JSON.stringify({
        deletions: [
          {
            startOffset: 7, // right after "Begin. "
            endOffset: 50, // middle of the "word word word..." stretch
            dropRationale: 'snap-test far',
            bracketLengthHint: 'short',
          },
        ],
      }),
      promptTokens: 50,
      completionTokens: 50,
    })
    const farResults = await phaseC2Micro(longSections, longDecisions, longCtx, longClient)
    expect(farResults[0].deletions).toHaveLength(0)
    expect(farResults[0].rejectedDeletions).toHaveLength(1)
    expect(farResults[0].rejectedDeletions[0].reason).toBe('splits-sentence')
  })

  it('rejects out-of-bounds ranges', async () => {
    const section = makeSection({
      order: 1,
      blocks: [makeBlock({ id: '1-0', text: 'Hello world. Short.', pageNumber: 1 })],
    })
    const sections = [section]
    const decisions = [makeDecision(section.id, 'KEEP_FULL')]
    const ctx = makeCtx(sections)
    const client = makeClient()
    const mock = client.useMockProvider()
    mock.setDefaultResponse({
      text: JSON.stringify({
        deletions: [
          {
            startOffset: 0,
            endOffset: 9999,
            dropRationale: 'too big',
            bracketLengthHint: 'short',
          },
        ],
      }),
      promptTokens: 5,
      completionTokens: 5,
    })
    const results = await phaseC2Micro(sections, decisions, ctx, client)
    expect(results[0].deletions).toHaveLength(0)
    expect(results[0].rejectedDeletions[0].reason).toBe('out-of-bounds')
  })

  it('records containedBlockIds for accepted deletions', async () => {
    const section = makeSection({
      order: 1,
      blocks: [
        makeBlock({ id: 'p1', text: 'Paragraph one with several sentences. Here is another. And one more.', pageNumber: 1 }),
        makeBlock({ id: 'p2', text: 'Paragraph two with material to keep.', pageNumber: 1 }),
      ],
    })
    const sections = [section]
    const decisions = [makeDecision(section.id, 'KEEP_PARTIAL')]
    const ctx = makeCtx(sections)
    const client = makeClient()
    const mock = client.useMockProvider()
    // The annotated rawText starts with p1 at offset 0 (no fence on body blocks).
    // p1.text length = 68. Then "\n\n" (offset 68..70). Then p2 starts at offset 70.
    // Pick [0, 68] to cut all of p1 cleanly.
    const fullText = section.rawText
    const p1Length = fullText.indexOf('\n\n')
    expect(p1Length).toBe(68)
    mock.setDefaultResponse({
      text: JSON.stringify({
        deletions: [
          {
            startOffset: 0,
            endOffset: p1Length,
            dropRationale: 'cut p1',
            bracketLengthHint: 'short',
          },
        ],
      }),
      promptTokens: 50,
      completionTokens: 50,
    })
    const results = await phaseC2Micro(sections, decisions, ctx, client)
    expect(results[0].deletions).toHaveLength(1)
    expect(results[0].deletions[0].containedBlockIds).toContain('p1')
  })
})
