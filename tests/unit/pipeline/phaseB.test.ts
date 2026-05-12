import { describe, expect, it } from 'vitest'

import { MockProvider } from '@/llm/mock'
import type { CallOptions, RawProviderResponse } from '@/llm/types'
import { phaseBSummarize } from '@/pipeline/phaseB-summarize'
import type { Section } from '@/pipeline/types'

import { makeClient } from './fixtures'

class ConcurrencyTrackingMock extends MockProvider {
  inFlight = 0
  maxInFlight = 0

  override async call(model: string, opts: CallOptions): Promise<RawProviderResponse> {
    this.inFlight += 1
    if (this.inFlight > this.maxInFlight) this.maxInFlight = this.inFlight
    try {
      return await super.call(model, opts)
    } finally {
      this.inFlight -= 1
    }
  }
}

function makeSection(order: number, opts: Partial<Section> = {}): Section {
  return {
    id: opts.id ?? `sec-${String(order).padStart(3, '0')}-test`,
    order,
    title: opts.title ?? `Section ${order}`,
    startPage: opts.startPage ?? order,
    endPage: opts.endPage ?? order,
    blocks: opts.blocks ?? [],
    rawText: opts.rawText ?? `Body of section ${order}. Some prose follows here for the model.`,
    source: opts.source ?? 'llm-detected',
    confidence: opts.confidence ?? 0.8,
  }
}

function validSummaryJson(order: number): string {
  return JSON.stringify({
    summary: `Summary paragraph for section ${order} containing the key argument.`,
    signals: {
      isCore: order % 2 === 1,
      hasFamousArgument: false,
      narrativeFunction: 'argument',
      density: 'medium',
    },
    voiceSample:
      'A representative passage taken verbatim from the section that captures the register of the author and shows the rhetorical posture they take.',
  })
}

describe('phaseBSummarize', () => {
  it('fills summary, signals, and voiceSample for each section', async () => {
    const sections = [makeSection(1), makeSection(2), makeSection(3)]
    const client = makeClient()
    const mock = client.useMockProvider()
    for (const s of sections) {
      mock.registerResponse(s.id, {
        text: validSummaryJson(s.order),
        promptTokens: 5,
        completionTokens: 30,
      })
    }
    const result = await phaseBSummarize(sections, 'understand the argument', client)
    expect(result).toHaveLength(3)
    for (const s of result) {
      expect(s.summary).toMatch(/Summary paragraph/)
      expect(s.signals?.narrativeFunction).toBe('argument')
      expect(s.voiceSample?.length).toBeGreaterThan(20)
    }
  })

  it('respects bounded concurrency (max 2 in flight by default)', async () => {
    const sections = Array.from({ length: 6 }, (_, i) => makeSection(i + 1))
    const client = makeClient()
    const tracking = new ConcurrencyTrackingMock('anthropic')
    tracking.setLatency(10)
    tracking.setDefaultResponse({
      text: validSummaryJson(1),
      promptTokens: 5,
      completionTokens: 30,
    })
    // Swap the private adapter on the client to use our subclass.
    // The LLMClient public API only exposes useMockProvider() which creates
    // a vanilla MockProvider; for this test we need a subclass.
    ;(client as unknown as { adapter: ConcurrencyTrackingMock; provider: 'anthropic' }).adapter = tracking
    await phaseBSummarize(sections, 'purpose', client, { concurrency: 2 })
    expect(tracking.maxInFlight).toBeLessThanOrEqual(2)
    expect(tracking.callCount()).toBe(6)
  })

  it('uses placeholder for a failed section without killing the phase', async () => {
    const sections = [makeSection(1), makeSection(2), makeSection(3)]
    const client = makeClient()
    const mock = client.useMockProvider()
    mock.registerResponse('sec-001-test', {
      text: validSummaryJson(1),
      promptTokens: 5,
      completionTokens: 30,
    })
    mock.registerResponse('sec-002-test', {
      text: 'not json',
      promptTokens: 5,
      completionTokens: 10,
    })
    mock.registerResponse('sec-003-test', {
      text: validSummaryJson(3),
      promptTokens: 5,
      completionTokens: 30,
    })
    const events: string[] = []
    const result = await phaseBSummarize(sections, 'purpose', client, {
      emit: (e) => {
        if (e.kind === 'phase-error') events.push(e.error)
      },
    })
    expect(result).toHaveLength(3)
    expect(result[1].summary).toBe('[summary unavailable]')
    expect(result[0].summary).toMatch(/Summary paragraph/)
    expect(result[2].summary).toMatch(/Summary paragraph/)
    expect(events.some((e) => e.includes('sec-002-test'))).toBe(true)
  })

  it('invokes onSectionDone callback per completion', async () => {
    const sections = [makeSection(1), makeSection(2)]
    const client = makeClient()
    const mock = client.useMockProvider()
    mock.setDefaultResponse({
      text: validSummaryJson(1),
      promptTokens: 5,
      completionTokens: 30,
    })
    const done: string[] = []
    await phaseBSummarize(sections, 'purpose', client, {
      onSectionDone: (s) => done.push(s.id),
    })
    expect(done).toHaveLength(2)
  })
})
