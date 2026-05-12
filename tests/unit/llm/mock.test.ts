import { describe, it, expect } from 'vitest'
import { MockProvider } from '@/llm/mock'
import type { CallOptions } from '@/llm/types'

const baseOpts = (overrides: Partial<CallOptions> = {}): CallOptions => ({
  role: 'cheap',
  user: 'hello',
  metadata: { phase: 'phaseA', requestId: 'req-1' },
  ...overrides,
})

describe('MockProvider', () => {
  it('returns registered response when matcher key is found in user prompt', async () => {
    const mock = new MockProvider('anthropic')
    mock.registerResponse('SECTION_BOUNDARIES', {
      text: '{"boundary":1}',
      promptTokens: 100,
      completionTokens: 50,
    })
    const result = await mock.call('claude-haiku', baseOpts({ user: 'Detect SECTION_BOUNDARIES please' }))
    expect(result.text).toBe('{"boundary":1}')
    expect(result.promptTokens).toBe(100)
    expect(result.completionTokens).toBe(50)
  })

  it('falls back to default response when no matcher hits', async () => {
    const mock = new MockProvider('openai')
    mock.setDefaultResponse({ text: 'fallback', promptTokens: 1, completionTokens: 2 })
    const result = await mock.call('gpt-4o', baseOpts())
    expect(result.text).toBe('fallback')
    expect(result.promptTokens).toBe(1)
    expect(result.completionTokens).toBe(2)
  })

  it('matches against phase metadata too', async () => {
    const mock = new MockProvider('anthropic')
    mock.registerResponse('phaseB5', { text: 'spine-doc' })
    const result = await mock.call('claude', baseOpts({ metadata: { phase: 'phaseB5', requestId: 'r' } }))
    expect(result.text).toBe('spine-doc')
  })

  it('tracks call count', async () => {
    const mock = new MockProvider('anthropic')
    expect(mock.callCount()).toBe(0)
    await mock.call('m', baseOpts())
    await mock.call('m', baseOpts())
    expect(mock.callCount()).toBe(2)
  })

  it('tracks calls per matcher key', async () => {
    const mock = new MockProvider('anthropic')
    await mock.call('m', baseOpts({ user: 'foo TARGET bar' }))
    await mock.call('m', baseOpts({ user: 'nothing here' }))
    await mock.call('m', baseOpts({ user: 'TARGET again' }))
    expect(mock.callsFor('TARGET')).toBe(2)
  })

  it('respects configured latency and resolves after it', async () => {
    const mock = new MockProvider('anthropic')
    mock.setLatency(5)
    const start = Date.now()
    await mock.call('m', baseOpts())
    const elapsed = Date.now() - start
    expect(elapsed).toBeGreaterThanOrEqual(4)
  })

  it('aborts via signal when latency configured', async () => {
    const mock = new MockProvider('anthropic')
    mock.setLatency(1000)
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 5)
    await expect(
      mock.call('m', baseOpts({ signal: controller.signal })),
    ).rejects.toThrow()
  })

  it('reset clears entries and history', async () => {
    const mock = new MockProvider('anthropic')
    mock.registerResponse('X', { text: 'x' })
    await mock.call('m', baseOpts({ user: 'X' }))
    mock.reset()
    expect(mock.callCount()).toBe(0)
    const result = await mock.call('m', baseOpts({ user: 'X' }))
    expect(result.text).toBe('mock-response')
  })

  it('history returns recorded calls in order', async () => {
    const mock = new MockProvider('anthropic')
    await mock.call('m1', baseOpts({ user: 'one' }))
    await mock.call('m2', baseOpts({ user: 'two' }))
    const hist = mock.history()
    expect(hist).toHaveLength(2)
    expect(hist[0]?.model).toBe('m1')
    expect(hist[1]?.opts.user).toBe('two')
  })

  it('matcher predicate variant works against any signal', async () => {
    const mock = new MockProvider('anthropic')
    mock.registerMatcher(
      'has-system',
      (_model, opts) => Boolean(opts.system),
      { text: 'with-system' },
    )
    const r1 = await mock.call('m', baseOpts({ system: 'sys' }))
    const r2 = await mock.call('m', baseOpts())
    expect(r1.text).toBe('with-system')
    expect(r2.text).toBe('mock-response')
  })
})
