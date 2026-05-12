import { describe, expect, it } from 'vitest'

import { phaseC15Sanity } from '@/pipeline/phaseC15-sanity'
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

const CTX: Pick<BookContext, 'purpose' | 'spine' | 'canonicalPassages'> = {
  purpose: 'understand the test argument',
  spine: SPINE,
  canonicalPassages: [],
}

function makeSection(order: number, opts: Partial<Section> = {}): Section {
  return {
    id: opts.id ?? `sec-${String(order).padStart(3, '0')}`,
    order,
    title: opts.title ?? `Section ${order}`,
    startPage: opts.startPage ?? order,
    endPage: opts.endPage ?? order,
    blocks: opts.blocks ?? [],
    rawText:
      opts.rawText ??
      `Opening paragraph of section ${order}. With sentences that go on for a while and detail the local matter at hand in this part of the book.`,
    summary: opts.summary ?? `Summary for section ${order}.`,
    signals: opts.signals ?? {
      isCore: false,
      hasFamousArgument: false,
      narrativeFunction: 'digression',
      density: 'light',
    },
    voiceSample: opts.voiceSample ?? 'voice sample',
    source: opts.source ?? 'llm-detected',
    confidence: opts.confidence ?? 0.8,
  }
}

function makeDecision(id: string, verdict: MacroVerdict, confidence = 0.5): MacroDecision {
  return {
    sectionId: id,
    verdict,
    rationale: `initial rationale for ${id}`,
    forwardDependencies: [],
    backwardDependencies: [],
    confidence,
  }
}

describe('phaseC15Sanity', () => {
  it('escalates COMPRESS to KEEP_PARTIAL when the model reports escalate=true', async () => {
    const sections = [makeSection(1), makeSection(2)]
    const decisions: MacroDecision[] = [
      makeDecision(sections[0].id, 'KEEP_FULL', 0.9),
      makeDecision(sections[1].id, 'COMPRESS_TO_BRACKET', 0.4),
    ]
    const client = makeClient()
    const mock = client.useMockProvider()
    mock.setDefaultResponse({
      text: JSON.stringify({
        escalate: true,
        reason: 'Contains a direct quote from Dewey that anchors the central argument.',
      }),
      promptTokens: 30,
      completionTokens: 30,
    })
    const result = await phaseC15Sanity(sections, decisions, CTX, client)
    expect(result).toHaveLength(2)
    expect(result[0].verdict).toBe('KEEP_FULL')
    expect(result[1].verdict).toBe('KEEP_PARTIAL')
    expect(result[1].rationale).toMatch(/escalated by sanity pass/i)
    expect(result[1].confidence).toBeGreaterThanOrEqual(0.8)
  })

  it('never demotes KEEP_FULL or KEEP_PARTIAL — they are not even sent to the model', async () => {
    const sections = [makeSection(1), makeSection(2), makeSection(3)]
    const decisions: MacroDecision[] = [
      makeDecision(sections[0].id, 'KEEP_FULL', 0.9),
      makeDecision(sections[1].id, 'KEEP_PARTIAL', 0.7),
      makeDecision(sections[2].id, 'COMPRESS_TO_BRACKET', 0.3),
    ]
    const client = makeClient()
    const mock = client.useMockProvider()
    mock.setDefaultResponse({
      text: JSON.stringify({ escalate: false, reason: 'no escalation' }),
      promptTokens: 5,
      completionTokens: 5,
    })
    const result = await phaseC15Sanity(sections, decisions, CTX, client)
    expect(result[0].verdict).toBe('KEEP_FULL')
    expect(result[1].verdict).toBe('KEEP_PARTIAL')
    expect(result[2].verdict).toBe('COMPRESS_TO_BRACKET')
    // Only the COMPRESS section should have been sent for review.
    expect(mock.callCount()).toBe(1)
    expect(mock.callsFor(sections[2].id)).toBe(1)
    expect(mock.callsFor(sections[0].id)).toBe(0)
    expect(mock.callsFor(sections[1].id)).toBe(0)
  })

  it('leaves COMPRESS unchanged when the model says escalate=false', async () => {
    const sections = [makeSection(1)]
    const decisions: MacroDecision[] = [makeDecision(sections[0].id, 'DROP_TO_ONE_LINE', 0.6)]
    const client = makeClient()
    const mock = client.useMockProvider()
    mock.setDefaultResponse({
      text: JSON.stringify({ escalate: false, reason: 'nothing irreplaceable found.' }),
      promptTokens: 5,
      completionTokens: 5,
    })
    const result = await phaseC15Sanity(sections, decisions, CTX, client)
    expect(result[0].verdict).toBe('DROP_TO_ONE_LINE')
    expect(result[0].confidence).toBe(0.6)
  })

  it('preserves prior confidence when escalated section had higher confidence', async () => {
    const sections = [makeSection(1)]
    const decisions: MacroDecision[] = [
      makeDecision(sections[0].id, 'COMPRESS_TO_BRACKET', 0.95),
    ]
    const client = makeClient()
    const mock = client.useMockProvider()
    mock.setDefaultResponse({
      text: JSON.stringify({ escalate: true, reason: 'voice anchor present' }),
      promptTokens: 5,
      completionTokens: 5,
    })
    const result = await phaseC15Sanity(sections, decisions, CTX, client)
    expect(result[0].verdict).toBe('KEEP_PARTIAL')
    expect(result[0].confidence).toBe(0.95)
  })
})
