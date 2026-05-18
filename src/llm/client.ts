import { createAnthropicAdapter } from './anthropic'
import { CostMeter, BudgetExceededError } from './cost'
import { MockProvider } from './mock'
import { createOpenAIAdapter } from './openai'
import { computeCostUsd } from './pricing'
import { detectProvider } from './provider-detect'
import {
  RateLimitBucket,
  createRateLimitRegistry,
  parseRateLimitHeaders,
  parseRetryAfterMs,
} from './ratelimit'
import {
  DEFAULT_RETRY,
  defaultSleep,
  retryWithBackoff,
  type RetryConfig,
} from './retry'
import {
  UNTRUSTED_BOOK_CONTENT_SYSTEM_PROMPT,
  wrapBookContent,
} from './safety'
import type {
  CallOptions,
  CallResult,
  CallWithBookContentOptions,
  LLMError,
  Provider,
  ProviderAdapter,
  Role,
  RoleMapping,
  Usage,
} from './types'

// Anthropic model IDs require an exact dated form for non-Haiku tiers in
// this build. Bare aliases like `claude-sonnet-4-6` are rejected with a
// 400 invalid_request_error ("…is not a valid model name."), which is why
// Phase O calls were failing while Phase A (cheap/Haiku, dated) succeeded.
export const DEFAULT_MAPPING: RoleMapping = {
  anthropic: {
    cheap: 'claude-haiku-4-5-20251001',
    smart: 'claude-sonnet-4-5-20250929',
    reasoning: 'claude-opus-4-1-20250805',
  },
  openai: {
    cheap: 'gpt-4o-mini',
    smart: 'gpt-4o',
    reasoning: 'o1',
  },
}

export type ClientConfig = {
  provider: Provider
  apiKey: string
  ceilingUsd: number
  mapping?: RoleMapping
  retry?: RetryConfig
  estimateUsd?: (provider: Provider, model: string, opts: CallOptions) => number
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
  rng?: () => number
  onCallEvent?: (event: CallEvent) => void
}

export type CallEvent =
  | {
      kind: 'call-start'
      requestId: string
      phase: string
      sectionId?: string
      role: Role
      model: string
      estimateUsd: number
      startedAt: number
    }
  | {
      kind: 'call-end'
      requestId: string
      phase: string
      sectionId?: string
      role: Role
      model: string
      promptTokens: number
      completionTokens: number
      costUsd: number
      durationMs: number
      endedAt: number
    }
  | {
      kind: 'call-error'
      requestId: string
      phase: string
      sectionId?: string
      role: Role
      model: string
      errorKind: string
      message: string
      retried: number
      durationMs: number
      endedAt: number
    }
  | {
      kind: 'call-retry'
      requestId: string
      phase: string
      sectionId?: string
      role: Role
      model: string
      attempt: number
    }

const DEFAULT_ESTIMATE_USD = (provider: Provider, model: string, opts: CallOptions): number => {
  const promptTokens =
    estimateTokens(opts.system ?? '') + estimateTokens(opts.user)
  const completionTokens = opts.maxTokens ?? 1024
  return computeCostUsd(provider, model, promptTokens, completionTokens)
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4))
}

export class LLMClient {
  private mapping: RoleMapping
  private adapter: ProviderAdapter
  private provider: Provider
  private apiKey: string
  private costMeter: CostMeter
  private retry: RetryConfig
  private estimateUsd: NonNullable<ClientConfig['estimateUsd']>
  private sleep: NonNullable<ClientConfig['sleep']>
  private rng: () => number
  private rateLimits = createRateLimitRegistry()
  private mock: MockProvider | null = null
  private onCallEvent: ((event: CallEvent) => void) | undefined

  constructor(config: ClientConfig) {
    this.provider = config.provider
    this.apiKey = config.apiKey
    this.mapping = config.mapping ?? cloneMapping(DEFAULT_MAPPING)
    this.adapter = buildAdapter(config.provider, config.apiKey)
    this.costMeter = new CostMeter(config.ceilingUsd)
    this.retry = config.retry ?? DEFAULT_RETRY
    this.estimateUsd = config.estimateUsd ?? DEFAULT_ESTIMATE_USD
    this.sleep = config.sleep ?? defaultSleep
    this.rng = config.rng ?? Math.random
    this.onCallEvent = config.onCallEvent
  }

  setOnCallEvent(listener: ((event: CallEvent) => void) | undefined): void {
    this.onCallEvent = listener
  }

  private emit(event: CallEvent): void {
    if (!this.onCallEvent) return
    try {
      this.onCallEvent(event)
    } catch {
      // listener errors must never break the pipeline
    }
  }

  static fromApiKey(apiKey: string, ceilingUsd: number): LLMClient {
    const detected = detectProvider(apiKey)
    if (!detected.looksValid || !detected.provider) {
      throw new Error('Unrecognized API key format. Use sk-ant-* (Anthropic) or sk-*/sk-proj-* (OpenAI).')
    }
    return new LLMClient({ provider: detected.provider, apiKey, ceilingUsd })
  }

  getProvider(): Provider {
    return this.provider
  }

  modelFor(role: Role): string {
    return this.mapping[this.provider][role]
  }

  setModelForRole(provider: Provider, role: Role, modelId: string): void {
    this.mapping = {
      ...this.mapping,
      [provider]: { ...this.mapping[provider], [role]: modelId },
    }
  }

  getCostMeter(): CostMeter {
    return this.costMeter
  }

  getRateLimitBucket(): RateLimitBucket {
    return this.rateLimits.get(this.provider)
  }

  useMockProvider(provider: Provider = this.provider): MockProvider {
    const mock = new MockProvider(provider)
    this.mock = mock
    this.provider = provider
    this.adapter = mock
    return mock
  }

  useRealProvider(): void {
    this.mock = null
    this.adapter = buildAdapter(this.provider, this.apiKey)
  }

  isMocked(): boolean {
    return this.mock !== null
  }

  async call(opts: CallOptions): Promise<CallResult> {
    return this.dispatch(opts)
  }

  async callWithBookContent(opts: CallWithBookContentOptions): Promise<CallResult> {
    const wrapped = wrapBookContent(opts.bookContent)
    const system = opts.system
      ? `${UNTRUSTED_BOOK_CONTENT_SYSTEM_PROMPT}\n\n${opts.system}`
      : UNTRUSTED_BOOK_CONTENT_SYSTEM_PROMPT
    const user = `${opts.user}\n\n${wrapped}`
    return this.dispatch({
      ...opts,
      system,
      user,
    })
  }

  private async dispatch(opts: CallOptions): Promise<CallResult> {
    const model = this.modelFor(opts.role)
    const estimate = this.estimateUsd(this.provider, model, opts)
    const requestId = opts.metadata?.requestId ?? generateRequestId()
    const phase = opts.metadata?.phase ?? 'unknown'
    const sectionId = opts.metadata?.sectionId
    const startedAt = Date.now()

    // Reserve budget. If the estimate would exceed the ceiling, the call
    // PAUSES inside the meter until either (a) the ceiling is raised
    // (cost.setCeiling), or (b) the user explicitly cancels via
    // costMeter.cancelAllPending(). This replaces the previous "throw and
    // abort the whole pipeline" behaviour with backpressure: in-flight
    // calls stack up safely while the user decides whether to keep going.
    try {
      await this.costMeter.reserveOrWait(estimate, opts.signal)
    } catch (err) {
      if (err instanceof BudgetExceededError) {
        return { ok: false, error: err.toLLMError(), retried: 0 }
      }
      return {
        ok: false,
        error: { kind: 'unknown', message: errorMessage(err) },
        retried: 0,
      }
    }

    this.emit({
      kind: 'call-start',
      requestId,
      phase,
      sectionId,
      role: opts.role,
      model,
      estimateUsd: estimate,
      startedAt,
    })

    logCallStart(requestId, phase, sectionId, opts.role, model, opts)

    let totalRetried = 0
    try {
      const bucket = this.rateLimits.get(this.provider)
      const result = await retryWithBackoff<{
        text: string
        usage: Usage
        raw: unknown
      }>(
        async (attempt) => {
          if (attempt > 0) {
            this.emit({
              kind: 'call-retry',
              requestId,
              phase,
              sectionId,
              role: opts.role,
              model,
              attempt,
            })
          }
          totalRetried = attempt
          const wait = bucket.waitMs()
          if (wait > 0) await this.sleep(wait, opts.signal)
          if (opts.signal?.aborted) {
            return { ok: false, error: { kind: 'aborted' } }
          }
          try {
            const raw = await this.adapter.call(model, opts)
            bucket.update(parseRateLimitHeaders(this.provider, raw.responseHeaders))
            const costUsd = computeCostUsd(
              this.provider,
              model,
              raw.promptTokens,
              raw.completionTokens,
            )
            const usage: Usage = {
              promptTokens: raw.promptTokens,
              completionTokens: raw.completionTokens,
              totalTokens: raw.promptTokens + raw.completionTokens,
              costUsd,
            }
            return {
              ok: true,
              value: { text: raw.text, usage, raw: raw.raw },
            }
          } catch (err) {
            return { ok: false, error: classifyError(err) }
          }
        },
        { sleep: this.sleep, rng: this.rng },
        this.retry,
        opts.signal,
      )

      if (!result.ok) {
        this.costMeter.cancel(estimate)
        this.costMeter.recordCallFailed()
        const endedAt = Date.now()
        const errMsg = 'message' in result.error ? result.error.message : result.error.kind
        logCallError(requestId, phase, opts.role, model, endedAt - startedAt, result.error.kind, errMsg)
        this.emit({
          kind: 'call-error',
          requestId,
          phase,
          sectionId,
          role: opts.role,
          model,
          errorKind: result.error.kind,
          message: errMsg,
          retried: result.attempts,
          durationMs: endedAt - startedAt,
          endedAt,
        })
        return { ok: false, error: result.error, retried: result.attempts }
      }

      this.costMeter.commit(estimate, result.value.usage.costUsd)
      this.costMeter.recordCallCompleted(
        result.value.usage.promptTokens,
        result.value.usage.completionTokens,
      )
      const endedAt = Date.now()
      logCallEnd(requestId, phase, opts.role, model, endedAt - startedAt, result.value.usage, result.value.text)
      this.emit({
        kind: 'call-end',
        requestId,
        phase,
        sectionId,
        role: opts.role,
        model,
        promptTokens: result.value.usage.promptTokens,
        completionTokens: result.value.usage.completionTokens,
        costUsd: result.value.usage.costUsd,
        durationMs: endedAt - startedAt,
        endedAt,
      })
      return {
        ok: true,
        data: result.value.text,
        usage: result.value.usage,
        raw: result.value.raw,
      }
    } catch (err) {
      this.costMeter.cancel(estimate)
      this.costMeter.recordCallFailed()
      const endedAt = Date.now()
      this.emit({
        kind: 'call-error',
        requestId,
        phase,
        sectionId,
        role: opts.role,
        model,
        errorKind: 'unknown',
        message: errorMessage(err),
        retried: totalRetried,
        durationMs: endedAt - startedAt,
        endedAt,
      })
      return {
        ok: false,
        error: { kind: 'unknown', message: errorMessage(err) },
        retried: totalRetried,
      }
    }
  }
}

function previewText(s: string | undefined, max = 600): string {
  if (!s) return ''
  return s.length <= max ? s : `${s.slice(0, max)}…[${s.length - max} more chars]`
}

function logCallStart(
  requestId: string,
  phase: string,
  sectionId: string | undefined,
  role: Role,
  model: string,
  opts: CallOptions,
): void {
  console.log(
    `[abridger ▶] ${phase}${sectionId ? `:${sectionId}` : ''} ${role}/${model} ${requestId}`,
    {
      requestId,
      phase,
      sectionId,
      role,
      model,
      systemPreview: previewText(opts.system, 400),
      userPreview: previewText(opts.user, 800),
      userLength: opts.user?.length ?? 0,
      systemLength: opts.system?.length ?? 0,
      temperature: opts.temperature,
      maxTokens: opts.maxTokens,
    },
  )
}

function logCallEnd(
  requestId: string,
  phase: string,
  role: Role,
  model: string,
  durationMs: number,
  usage: Usage,
  text: string,
): void {
  console.log(
    `[abridger ◀] ${phase} ${role}/${model} ${requestId} ${durationMs}ms in:${usage.promptTokens} out:${usage.completionTokens} $${usage.costUsd.toFixed(4)}`,
    {
      requestId,
      durationMs,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      costUsd: usage.costUsd,
      responsePreview: previewText(text, 1200),
      responseLength: text.length,
      responseFull: text,
    },
  )
}

function logCallError(
  requestId: string,
  phase: string,
  role: Role,
  model: string,
  durationMs: number,
  errorKind: string,
  message: string,
): void {
  console.warn(
    `[abridger ✗] ${phase} ${role}/${model} ${requestId} ${durationMs}ms ${errorKind}`,
    { requestId, errorKind, message },
  )
}

function generateRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `req-${crypto.randomUUID()}`
  }
  return `req-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function cloneMapping(mapping: RoleMapping): RoleMapping {
  return {
    anthropic: { ...mapping.anthropic },
    openai: { ...mapping.openai },
  }
}

function buildAdapter(provider: Provider, apiKey: string): ProviderAdapter {
  if (provider === 'anthropic') return createAnthropicAdapter({ apiKey })
  return createOpenAIAdapter({ apiKey })
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  return 'unknown error'
}

function classifyError(err: unknown): LLMError {
  if (err instanceof DOMException && err.name === 'AbortError') {
    return { kind: 'aborted' }
  }
  if (err && typeof err === 'object') {
    const e = err as {
      name?: string
      status?: number
      message?: string
      headers?: Record<string, string>
      error?: { type?: string; message?: string }
    }
    const status = typeof e.status === 'number' ? e.status : undefined
    if (status === 401 || status === 403) {
      return { kind: 'authentication', message: e.message ?? 'Authentication failed' }
    }
    if (status === 429) {
      const headers = e.headers ?? {}
      const retryAfterMs = parseRetryAfterMs(headers)
      return { kind: 'rate-limited', retryAfterMs }
    }
    if (status === 400 && /context|too long|maximum/i.test(e.message ?? e.error?.message ?? '')) {
      return { kind: 'context-overflow', message: e.message ?? 'Context overflow' }
    }
    if (status && status >= 500) {
      return { kind: 'network', message: e.message ?? `Server error ${status}` }
    }
    if (e.name === 'TypeError' || /fetch failed|network|ECONN|ENOTFOUND/i.test(e.message ?? '')) {
      return { kind: 'network', message: e.message ?? 'Network error' }
    }
    return { kind: 'unknown', message: e.message ?? 'unknown error', raw: err }
  }
  return { kind: 'unknown', message: 'unknown error', raw: err }
}
