import type {
  CallOptions,
  Provider,
  ProviderAdapter,
  RawProviderResponse,
} from './types'

export type MockResponse = {
  text: string
  promptTokens?: number
  completionTokens?: number
  headers?: Record<string, string>
  delayMs?: number
}

export type MockMatcher = (model: string, opts: CallOptions) => boolean

type Entry = {
  key: string
  matcher: MockMatcher
  response: MockResponse
}

export class MockProvider implements ProviderAdapter {
  readonly provider: Provider
  private entries: Entry[] = []
  private defaultResponse: MockResponse = {
    text: 'mock-response',
    promptTokens: 10,
    completionTokens: 20,
  }
  private latencyMs = 0
  private calls: Array<{ model: string; opts: CallOptions }> = []

  constructor(provider: Provider = 'anthropic') {
    this.provider = provider
  }

  setLatency(ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) {
      throw new Error(`Invalid latency: ${ms}`)
    }
    this.latencyMs = ms
  }

  setDefaultResponse(response: MockResponse): void {
    this.defaultResponse = response
  }

  registerResponse(matcherKey: string, response: MockResponse): void {
    const matcher: MockMatcher = (_model, opts) => {
      const hay = `${opts.metadata.phase}|${opts.metadata.requestId}|${opts.metadata.sectionId ?? ''}|${opts.system ?? ''}|${opts.user}`
      return hay.includes(matcherKey)
    }
    this.entries = [...this.entries, { key: matcherKey, matcher, response }]
  }

  registerMatcher(key: string, matcher: MockMatcher, response: MockResponse): void {
    this.entries = [...this.entries, { key, matcher, response }]
  }

  reset(): void {
    this.entries = []
    this.calls = []
    this.latencyMs = 0
  }

  callCount(): number {
    return this.calls.length
  }

  callsFor(matcherKey: string): number {
    return this.calls.filter(({ model, opts }) => {
      const hay = `${opts.metadata.phase}|${opts.metadata.requestId}|${opts.metadata.sectionId ?? ''}|${opts.system ?? ''}|${opts.user}|${model}`
      return hay.includes(matcherKey)
    }).length
  }

  history(): ReadonlyArray<{ model: string; opts: CallOptions }> {
    return this.calls
  }

  async call(model: string, opts: CallOptions): Promise<RawProviderResponse> {
    this.calls = [...this.calls, { model, opts }]
    if (this.latencyMs > 0) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, this.latencyMs)
        if (opts.signal) {
          opts.signal.addEventListener(
            'abort',
            () => {
              clearTimeout(timer)
              reject(new DOMException('Aborted', 'AbortError'))
            },
            { once: true },
          )
        }
      })
    }
    if (opts.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError')
    }
    const match = this.entries.find((e) => e.matcher(model, opts))
    const response = match?.response ?? this.defaultResponse
    return {
      text: response.text,
      promptTokens: response.promptTokens ?? estimateTokens(opts.user) + estimateTokens(opts.system ?? ''),
      completionTokens: response.completionTokens ?? estimateTokens(response.text),
      raw: { mock: true, key: match?.key ?? null },
      responseHeaders: response.headers ?? {},
    }
  }
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4))
}
