import type { Provider, RateLimitSnapshot } from './types'

export type RateLimitThresholds = {
  minRequestsRemaining: number
  minTokensRemaining: number
}

export const DEFAULT_THRESHOLDS: RateLimitThresholds = {
  minRequestsRemaining: 2,
  minTokensRemaining: 1000,
}

const ANTHROPIC_HEADERS = {
  requestsRemaining: 'anthropic-ratelimit-requests-remaining',
  tokensRemaining: 'anthropic-ratelimit-tokens-remaining',
  requestsReset: 'anthropic-ratelimit-requests-reset',
  tokensReset: 'anthropic-ratelimit-tokens-reset',
  retryAfter: 'retry-after',
} as const

const OPENAI_HEADERS = {
  requestsRemaining: 'x-ratelimit-remaining-requests',
  tokensRemaining: 'x-ratelimit-remaining-tokens',
  requestsReset: 'x-ratelimit-reset-requests',
  tokensReset: 'x-ratelimit-reset-tokens',
  retryAfter: 'retry-after',
} as const

function parseIntSafe(value: string | undefined): number | null {
  if (!value) return null
  const n = Number.parseInt(value, 10)
  return Number.isFinite(n) ? n : null
}

function parseFloatSafe(value: string | undefined): number | null {
  if (!value) return null
  const n = Number.parseFloat(value)
  return Number.isFinite(n) ? n : null
}

function parseResetTimestamp(value: string | undefined, now: number): number | null {
  if (!value) return null
  // OpenAI: durations like "1s", "100ms", "1m30s", or "12.5s"
  const durationMatch = value.match(/^((?:\d+(?:\.\d+)?(?:ms|s|m|h))+)$/)
  if (durationMatch) {
    let total = 0
    const re = /(\d+(?:\.\d+)?)(ms|s|m|h)/g
    let m: RegExpExecArray | null
    while ((m = re.exec(value)) !== null) {
      const n = Number.parseFloat(m[1])
      switch (m[2]) {
        case 'ms':
          total += n
          break
        case 's':
          total += n * 1000
          break
        case 'm':
          total += n * 60_000
          break
        case 'h':
          total += n * 3_600_000
          break
      }
    }
    return now + total
  }
  // ISO timestamp (Anthropic)
  const ts = Date.parse(value)
  if (Number.isFinite(ts)) return ts
  // Bare number: seconds-until-reset
  const n = parseFloatSafe(value)
  if (n !== null) return now + n * 1000
  return null
}

export function parseRateLimitHeaders(
  provider: Provider,
  headers: Record<string, string>,
  now: number = Date.now(),
): RateLimitSnapshot {
  const map = normalizeHeaders(headers)
  const spec = provider === 'anthropic' ? ANTHROPIC_HEADERS : OPENAI_HEADERS
  return {
    requestsRemaining: parseIntSafe(map[spec.requestsRemaining]),
    tokensRemaining: parseIntSafe(map[spec.tokensRemaining]),
    requestsResetAt: parseResetTimestamp(map[spec.requestsReset], now),
    tokensResetAt: parseResetTimestamp(map[spec.tokensReset], now),
  }
}

export function parseRetryAfterMs(
  headers: Record<string, string>,
  now: number = Date.now(),
): number {
  const map = normalizeHeaders(headers)
  const raw = map['retry-after']
  if (!raw) return 0
  const seconds = parseFloatSafe(raw)
  if (seconds !== null) return Math.max(0, seconds * 1000)
  const ts = Date.parse(raw)
  if (Number.isFinite(ts)) return Math.max(0, ts - now)
  return 0
}

function normalizeHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(headers)) {
    out[k.toLowerCase()] = v
  }
  return out
}

export class RateLimitBucket {
  private snapshot: RateLimitSnapshot

  constructor(initial?: Partial<RateLimitSnapshot>) {
    this.snapshot = {
      requestsRemaining: initial?.requestsRemaining ?? null,
      tokensRemaining: initial?.tokensRemaining ?? null,
      requestsResetAt: initial?.requestsResetAt ?? null,
      tokensResetAt: initial?.tokensResetAt ?? null,
    }
  }

  update(next: RateLimitSnapshot): void {
    this.snapshot = { ...next }
  }

  read(): RateLimitSnapshot {
    return { ...this.snapshot }
  }

  /** Returns ms to wait before next dispatch, or 0 if it's fine to dispatch now. */
  waitMs(
    now: number = Date.now(),
    thresholds: RateLimitThresholds = DEFAULT_THRESHOLDS,
  ): number {
    let wait = 0
    const s = this.snapshot
    if (s.requestsRemaining !== null && s.requestsRemaining < thresholds.minRequestsRemaining) {
      if (s.requestsResetAt !== null) {
        wait = Math.max(wait, s.requestsResetAt - now)
      }
    }
    if (s.tokensRemaining !== null && s.tokensRemaining < thresholds.minTokensRemaining) {
      if (s.tokensResetAt !== null) {
        wait = Math.max(wait, s.tokensResetAt - now)
      }
    }
    return Math.max(0, wait)
  }
}

export type RateLimitRegistry = {
  get(provider: Provider): RateLimitBucket
}

export function createRateLimitRegistry(): RateLimitRegistry {
  const buckets = new Map<Provider, RateLimitBucket>()
  return {
    get(provider): RateLimitBucket {
      const existing = buckets.get(provider)
      if (existing) return existing
      const fresh = new RateLimitBucket()
      buckets.set(provider, fresh)
      return fresh
    },
  }
}
