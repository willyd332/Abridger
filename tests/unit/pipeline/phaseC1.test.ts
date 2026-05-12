import { describe, expect, it } from 'vitest'

import { phaseC1Macro } from '@/pipeline/phaseC1-macro'
import type {
  BookContext,
  MacroDecision,
  MacroVerdict,
  NarrativeSpine,
  Section,
} from '@/pipeline/types'

import { makeClient } from './fixtures'

const SPINE: NarrativeSpine = {
  centralArgument: 'A test argument about test sections.',
  narrativeShape: 'It opens, develops, lands.',
  recurringMotifs: ['motif a', 'motif b'],
  voiceAnchors: ['a verbatim 30-80 word passage representing the test author voice in this section.'],
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
    rawText: opts.rawText ?? `Body for section ${order}. Some prose.`,
    summary: opts.summary ?? `Summary for section ${order}.`,
    signals: opts.signals ?? {
      isCore: order % 2 === 1,
      hasFamousArgument: false,
      narrativeFunction: 'argument',
      density: 'medium',
    },
    voiceSample: opts.voiceSample ?? 'voice sample',
    source: opts.source ?? 'llm-detected',
    confidence: opts.confidence ?? 0.8,
  }
}

function makeDecision(
  id: string,
  verdict: MacroVerdict,
  confidence = 0.8,
): Omit<MacroDecision, 'rationale'> & { rationale: string } {
  return {
    sectionId: id,
    verdict,
    rationale: `rationale for ${id}`,
    forwardDependencies: [],
    backwardDependencies: [],
    confidence,
  }
}

describe('phaseC1Macro', () => {
  it('returns verdicts and dependencies in a single call for small books', async () => {
    const sections = Array.from({ length: 5 }, (_, i) => makeSection(i + 1))
    const client = makeClient()
    const mock = client.useMockProvider()
    mock.setDefaultResponse({
      text: JSON.stringify({
        decisions: sections.map((s, i) => ({
          ...makeDecision(s.id, i === 0 ? 'KEEP_FULL' : i === 4 ? 'DROP_TO_ONE_LINE' : 'KEEP_PARTIAL'),
          forwardDependencies: i < 4 ? [sections[i + 1].id] : [],
          backwardDependencies: i > 0 ? [sections[i - 1].id] : [],
          bracketLengthHint: i === 4 ? 'one-line' : 'short',
        })),
      }),
      promptTokens: 100,
      completionTokens: 400,
    })
    const decisions = await phaseC1Macro(sections, CTX, client)
    expect(decisions).toHaveLength(5)
    expect(decisions[0].verdict).toBe('KEEP_FULL')
    expect(decisions[4].verdict).toBe('DROP_TO_ONE_LINE')
    expect(decisions[2].verdict).toBe('KEEP_PARTIAL')
    expect(decisions[1].forwardDependencies).toContain(sections[2].id)
    expect(decisions[1].backwardDependencies).toContain(sections[0].id)
    expect(mock.callCount()).toBe(1)
  })

  it('chunks long books into windows and reconciles', async () => {
    const sections = Array.from({ length: 50 }, (_, i) => makeSection(i + 1))
    const client = makeClient()
    const { MockProvider } = await import('@/llm/mock')
    const tracking = new (class extends MockProvider {
      windowCalls = 0
      reconcileCalls = 0
      override async call(model: string, opts: import('@/llm/types').CallOptions) {
        const isReconcile = opts.metadata.requestId === 'phaseC1-reconcile'
        if (isReconcile) this.reconcileCalls += 1
        else this.windowCalls += 1
        const idsMatch = opts.user.match(/In-scope section IDs: (\[[^\]]+\])/)
        let ids: string[] = []
        if (idsMatch) {
          try {
            ids = JSON.parse(idsMatch[1]) as string[]
          } catch {
            ids = []
          }
        }
        const decisions = ids.map((id) => ({
          sectionId: id,
          verdict: 'KEEP_FULL' as MacroVerdict,
          rationale: `keep ${id}`,
          forwardDependencies: [],
          backwardDependencies: [],
          confidence: 0.9,
          bracketLengthHint: 'short' as const,
        }))
        return {
          text: JSON.stringify({ decisions }),
          promptTokens: 10,
          completionTokens: 50,
          raw: { mock: true, model },
          responseHeaders: {},
        }
      }
    })('anthropic')
    ;(client as unknown as { adapter: typeof tracking }).adapter = tracking
    const decisions = await phaseC1Macro(sections, CTX, client, {
      chunkThreshold: 40,
      chunkSize: 20,
      chunkOverlap: 4,
    })
    expect(decisions).toHaveLength(50)
    expect(decisions.every((d) => d.sectionId.startsWith('sec-'))).toBe(true)
    expect(decisions.every((d) => d.verdict === 'KEEP_FULL')).toBe(true)
    expect(tracking.windowCalls).toBeGreaterThan(1)
    // Reconciliation call only fires when there are contested sections; with all KEEP_FULL,
    // no contest -> reconcile NOT called. That is the expected behavior.
    expect(tracking.reconcileCalls).toBe(0)
  })

  it('retries on bad JSON, falls back to KEEP_FULL with confidence 0 on second failure', async () => {
    const sections = [makeSection(1), makeSection(2)]
    const client = makeClient()
    const mock = client.useMockProvider()
    mock.registerMatcher(
      'initial',
      (_m, opts) => opts.metadata.requestId === 'phaseC1-single',
      {
        text: 'not json',
        promptTokens: 5,
        completionTokens: 5,
      },
    )
    mock.registerMatcher(
      'strict',
      (_m, opts) => opts.metadata.requestId === 'phaseC1-single-strict',
      {
        text: 'still not json',
        promptTokens: 5,
        completionTokens: 5,
      },
    )
    const events: string[] = []
    const decisions = await phaseC1Macro(sections, CTX, client, {
      emit: (e) => {
        if (e.kind === 'phase-error') events.push(e.error)
      },
    })
    expect(decisions).toHaveLength(2)
    for (const d of decisions) {
      expect(d.verdict).toBe('KEEP_FULL')
      expect(d.confidence).toBe(0)
      expect(d.rationale).toMatch(/fallback/)
    }
    expect(mock.callsFor('phaseC1-single-strict')).toBe(1)
    expect(events.some((e) => /failed after retry/i.test(e))).toBe(true)
  })

  it('recovers when the model returns no decision for a section (fallback fills it)', async () => {
    const sections = [makeSection(1), makeSection(2), makeSection(3)]
    const client = makeClient()
    const mock = client.useMockProvider()
    mock.setDefaultResponse({
      text: JSON.stringify({
        decisions: [
          makeDecision(sections[0].id, 'KEEP_FULL'),
          makeDecision(sections[2].id, 'COMPRESS_TO_BRACKET'),
        ],
      }),
      promptTokens: 10,
      completionTokens: 50,
    })
    const decisions = await phaseC1Macro(sections, CTX, client)
    expect(decisions).toHaveLength(3)
    expect(decisions[0].verdict).toBe('KEEP_FULL')
    expect(decisions[1].verdict).toBe('KEEP_FULL')
    expect(decisions[1].confidence).toBe(0)
    expect(decisions[2].verdict).toBe('COMPRESS_TO_BRACKET')
  })
})
