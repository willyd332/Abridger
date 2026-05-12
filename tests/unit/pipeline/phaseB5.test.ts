import { describe, expect, it } from 'vitest'

import { phaseB5Spine } from '@/pipeline/phaseB5-spine'
import type { Section } from '@/pipeline/types'

import { makeClient } from './fixtures'

const ANCHOR_REAL =
  'A representative passage taken verbatim from the section that captures the register of the author and shows the rhetorical posture they take in this argument.'

function makeSection(order: number, opts: Partial<Section> = {}): Section {
  return {
    id: opts.id ?? `sec-${String(order).padStart(3, '0')}-test`,
    order,
    title: opts.title ?? `Section ${order}`,
    startPage: opts.startPage ?? order,
    endPage: opts.endPage ?? order,
    blocks: opts.blocks ?? [],
    rawText:
      opts.rawText ??
      `Section ${order} body. ${ANCHOR_REAL} Additional prose for downstream phases.`,
    summary: opts.summary ?? `Summary for section ${order}.`,
    signals: opts.signals ?? {
      isCore: true,
      hasFamousArgument: false,
      narrativeFunction: 'argument',
      density: 'medium',
    },
    voiceSample: opts.voiceSample ?? ANCHOR_REAL,
    source: opts.source ?? 'llm-detected',
    confidence: opts.confidence ?? 0.8,
  }
}

describe('phaseB5Spine', () => {
  it('returns spine with verified voice anchors', async () => {
    const sections = [makeSection(1), makeSection(2)]
    const client = makeClient()
    const mock = client.useMockProvider()
    mock.setDefaultResponse({
      text: JSON.stringify({
        centralArgument: 'The book argues that X for Y reasons.',
        narrativeShape: 'It opens with A, develops B, lands at C.',
        recurringMotifs: ['motif one', 'motif two', 'motif three'],
        voiceAnchors: [ANCHOR_REAL],
      }),
      promptTokens: 50,
      completionTokens: 200,
    })
    const spine = await phaseB5Spine(sections, 'purpose', [], client)
    expect(spine.centralArgument).toMatch(/argues that X/)
    expect(spine.recurringMotifs).toHaveLength(3)
    expect(spine.voiceAnchors).toHaveLength(1)
    expect(spine.voiceAnchors[0]).toBe(ANCHOR_REAL)
  })

  it('retries once and drops unverifiable anchors', async () => {
    const sections = [makeSection(1), makeSection(2)]
    const client = makeClient()
    const mock = client.useMockProvider()
    const fakeAnchor =
      'This is an entirely fabricated voice anchor that does not appear in any section of the book at all'
    // First call returns a fabricated anchor; strict retry still returns it.
    mock.registerMatcher(
      'initial',
      (_m, opts) => opts.metadata.requestId === 'phaseB5-initial',
      {
        text: JSON.stringify({
          centralArgument: 'arg',
          narrativeShape: 'shape',
          recurringMotifs: ['a', 'b'],
          voiceAnchors: [fakeAnchor, ANCHOR_REAL],
        }),
        promptTokens: 50,
        completionTokens: 200,
      },
    )
    mock.registerMatcher(
      'strict',
      (_m, opts) => opts.metadata.requestId === 'phaseB5-strict',
      {
        text: JSON.stringify({
          centralArgument: 'arg',
          narrativeShape: 'shape',
          recurringMotifs: ['a', 'b'],
          voiceAnchors: [fakeAnchor, ANCHOR_REAL],
        }),
        promptTokens: 50,
        completionTokens: 200,
      },
    )
    const events: string[] = []
    const spine = await phaseB5Spine(sections, 'purpose', [], client, {
      emit: (e) => {
        if (e.kind === 'phase-error') events.push(e.error)
      },
    })
    expect(spine.voiceAnchors).toEqual([ANCHOR_REAL])
    expect(mock.callsFor('phaseB5-strict')).toBe(1)
    expect(events.some((e) => e.includes('unverifiable'))).toBe(true)
  })

  it('returns fallback spine when JSON is invalid', async () => {
    const sections = [makeSection(1)]
    const client = makeClient()
    const mock = client.useMockProvider()
    mock.setDefaultResponse({
      text: 'not-json',
      promptTokens: 5,
      completionTokens: 5,
    })
    const spine = await phaseB5Spine(sections, 'purpose', [], client)
    expect(spine.centralArgument).toMatch(/unavailable/)
    expect(spine.voiceAnchors).toEqual([])
  })

  it('keeps all anchors when all are verified on first call', async () => {
    const sections = [makeSection(1)]
    const client = makeClient()
    const mock = client.useMockProvider()
    mock.setDefaultResponse({
      text: JSON.stringify({
        centralArgument: 'arg',
        narrativeShape: 'shape',
        recurringMotifs: ['a', 'b'],
        voiceAnchors: [ANCHOR_REAL],
      }),
      promptTokens: 50,
      completionTokens: 200,
    })
    await phaseB5Spine(sections, 'purpose', [], client)
    expect(mock.callsFor('phaseB5-strict')).toBe(0)
    expect(mock.callsFor('phaseB5-initial')).toBe(1)
  })
})
