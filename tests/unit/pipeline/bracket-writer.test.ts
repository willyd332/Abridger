import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { writeBracket, extractNamedTerms } from '@/pipeline/bracket-writer'
import type { BracketRequest } from '@/pipeline/bracket-writer'
import type { NarrativeSpine } from '@/pipeline/types'

import { makeClient } from './fixtures'

const SPINE: NarrativeSpine = {
  centralArgument: 'The book argues that quotas reshaped rural China.',
  narrativeShape: 'Opens with national policy, drills into provinces, ends with consequences.',
  recurringMotifs: ['procurement', 'quota', 'famine'],
  voiceAnchors: ['anchor passage of more than thirty words used as a voice anchor for the spine.'],
}

function makeRequest(overrides: Partial<BracketRequest> = {}): BracketRequest {
  return {
    deletedText:
      'In 1959, Mao Zedong toured Sichuan and Henan. The grain procurement quotas in Sichuan reached 38 percent. "We must eat," peasants said in private.',
    precedingContext: 'The grain procurement system had been in place since 1953.',
    followingContext: 'By the spring of 1960, the famine had reached every province.',
    targetLength: 'short',
    spine: SPINE,
    voiceSample: 'Famine, in this telling, was less a natural calamity than a procurement failure that the state could not admit.',
    purpose: 'understand the political economy of the Great Leap Forward',
    scope: 'micro',
    ...overrides,
  }
}

describe('extractNamedTerms', () => {
  it('extracts proper nouns, 4-digit years, and quotes', () => {
    const text =
      'In 1959, Mao Zedong toured Sichuan and Henan. "We must eat," peasants said.'
    const terms = extractNamedTerms(text)
    expect(terms).toContain('Mao Zedong')
    expect(terms).toContain('Sichuan')
    expect(terms).toContain('Henan')
    expect(terms).toContain('1959')
  })

  it('caps proper nouns at 20 unique terms', () => {
    const names = Array.from({ length: 30 }, (_, i) => `Person${i}A`).join(', ')
    const terms = extractNamedTerms(names)
    const propers = terms.filter((t) => /[A-Z][a-z]+/.test(t))
    expect(propers.length).toBeLessThanOrEqual(20)
  })

  it('does not duplicate names', () => {
    const text = 'Mao Zedong met Mao Zedong. Mao Zedong said.'
    const terms = extractNamedTerms(text)
    const maos = terms.filter((t) => t === 'Mao Zedong')
    expect(maos).toHaveLength(1)
  })
})

describe('writeBracket', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })

  afterEach(() => {
    warnSpy.mockRestore()
  })

  it('returns bracket text for the one-line budget', async () => {
    const client = makeClient()
    const mock = client.useMockProvider()
    mock.setDefaultResponse({
      text: JSON.stringify({
        bracketText: 'A short editorial bracket of one sentence.',
      }),
      promptTokens: 100,
      completionTokens: 20,
    })
    const result = await writeBracket(
      makeRequest({ targetLength: 'one-line' }),
      client,
    )
    expect(result.text).toBe('A short editorial bracket of one sentence.')
    expect(result.usage.promptTokens).toBe(100)
    expect(result.usage.completionTokens).toBe(20)
  })

  it('returns bracket text for the short budget', async () => {
    const client = makeClient()
    const mock = client.useMockProvider()
    mock.setDefaultResponse({
      text: JSON.stringify({
        bracketText:
          'The author then traces grain procurement through three provincial cases. The quotas in Sichuan reached 38 percent by 1959, and the peasants said in private that they could not eat.',
      }),
      promptTokens: 200,
      completionTokens: 60,
    })
    const result = await writeBracket(makeRequest({ targetLength: 'short' }), client)
    expect(result.text).toContain('grain procurement')
  })

  it('returns bracket text for the medium budget', async () => {
    const client = makeClient()
    const mock = client.useMockProvider()
    const text = Array.from({ length: 40 }, () => 'word').join(' ')
    mock.setDefaultResponse({
      text: JSON.stringify({ bracketText: text }),
      promptTokens: 300,
      completionTokens: 200,
    })
    const result = await writeBracket(makeRequest({ targetLength: 'medium' }), client)
    expect(result.text.split(/\s+/).length).toBeGreaterThanOrEqual(40)
  })

  it('returns bracket text for the long budget (macro scope)', async () => {
    const client = makeClient()
    const mock = client.useMockProvider()
    const text = Array.from({ length: 200 }, () => 'word').join(' ')
    mock.setDefaultResponse({
      text: JSON.stringify({ bracketText: text }),
      promptTokens: 500,
      completionTokens: 800,
    })
    const result = await writeBracket(
      makeRequest({ targetLength: 'long', scope: 'macro' }),
      client,
    )
    expect(result.text.length).toBeGreaterThan(100)
  })

  it('rejects malformed JSON by retrying then producing a fallback', async () => {
    const client = makeClient()
    const mock = client.useMockProvider()
    mock.setDefaultResponse({
      text: 'this is not JSON at all',
      promptTokens: 100,
      completionTokens: 5,
    })
    const result = await writeBracket(makeRequest(), client)
    expect(result.text).toMatch(/\[bracket-writer failed/)
    expect(warnSpy).toHaveBeenCalled()
  })

  it('retries once when output overshoots 5× the word budget, then truncates', async () => {
    const client = makeClient()
    const mock = client.useMockProvider()
    // 'short' budget approxMaxWords = 110, so >550 words triggers retry.
    const oversized = Array.from({ length: 800 }, (_, i) => `word${i}`).join(' ')
    const stillOversized = Array.from({ length: 700 }, (_, i) => `again${i}`).join(' ')
    let call = 0
    mock.registerMatcher(
      'first-attempt',
      () => {
        call += 1
        return call === 1
      },
      {
        text: JSON.stringify({ bracketText: oversized }),
        promptTokens: 100,
        completionTokens: 1000,
      },
    )
    mock.setDefaultResponse({
      text: JSON.stringify({ bracketText: stillOversized }),
      promptTokens: 100,
      completionTokens: 1000,
    })
    const result = await writeBracket(makeRequest({ targetLength: 'short' }), client)
    expect(call).toBe(2)
    // Truncated to ~110 words + ellipsis.
    expect(result.text.endsWith('…')).toBe(true)
    expect(result.text.split(/\s+/).length).toBeLessThanOrEqual(115)
    expect(warnSpy).toHaveBeenCalled()
  })

  it('truncates if even the strict retry overshoots', async () => {
    const client = makeClient()
    const mock = client.useMockProvider()
    const oversized = Array.from({ length: 800 }, (_, i) => `word${i}`).join(' ')
    mock.setDefaultResponse({
      text: JSON.stringify({ bracketText: oversized }),
      promptTokens: 100,
      completionTokens: 1000,
    })
    const result = await writeBracket(makeRequest({ targetLength: 'short' }), client)
    expect(result.text.endsWith('…')).toBe(true)
    expect(result.text.split(/\s+/).length).toBeLessThanOrEqual(115)
  })

  it('auto-extracts proper nouns when namedTermsToPreserve is not provided', async () => {
    const client = makeClient()
    const mock = client.useMockProvider()
    mock.setDefaultResponse({
      text: JSON.stringify({ bracketText: 'A bracket.' }),
      promptTokens: 50,
      completionTokens: 20,
    })
    await writeBracket(
      makeRequest({
        deletedText: 'In 1949, Mao Zedong declared the founding in Beijing.',
      }),
      client,
    )
    const history = mock.history()
    expect(history.length).toBeGreaterThan(0)
    const userText = history[0].opts.user
    expect(userText).toContain('Mao Zedong')
    expect(userText).toContain('Beijing')
    expect(userText).toContain('1949')
  })

  it('uses the explicit namedTermsToPreserve when provided', async () => {
    const client = makeClient()
    const mock = client.useMockProvider()
    mock.setDefaultResponse({
      text: JSON.stringify({ bracketText: 'A bracket.' }),
      promptTokens: 50,
      completionTokens: 20,
    })
    await writeBracket(
      makeRequest({
        namedTermsToPreserve: ['CustomTermXyz'],
        deletedText: 'Sentinel deleted text with no proper nouns at all.',
      }),
      client,
    )
    const history = mock.history()
    const userText = history[0].opts.user
    expect(userText).toContain('CustomTermXyz')
    // Auto-extraction should not have run; the only block listing terms shows our custom one.
    const namedSection = userText.split('Named terms / numbers / quotes the bracket MUST preserve from the deleted span:')[1] ?? ''
    expect(namedSection).toContain('- CustomTermXyz')
    expect(namedSection).not.toContain('- Sentinel')
  })

  it('wraps the deleted text via callWithBookContent (book content guard applied)', async () => {
    const client = makeClient()
    const mock = client.useMockProvider()
    mock.setDefaultResponse({
      text: JSON.stringify({ bracketText: 'OK.' }),
      promptTokens: 10,
      completionTokens: 5,
    })
    await writeBracket(makeRequest({ deletedText: 'SENTINEL_DELETED_TEXT' }), client)
    const history = mock.history()
    expect(history[0].opts.user).toContain('SENTINEL_DELETED_TEXT')
    expect(history[0].opts.user).toContain('<book_content>')
  })
})
