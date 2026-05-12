import type { LLMError } from './types'

export type RetryConfig = {
  maxRetries: number
  baseDelayMs: number
  maxDelayMs: number
  jitterRatio: number
}

export const DEFAULT_RETRY: RetryConfig = {
  maxRetries: 4,
  baseDelayMs: 500,
  maxDelayMs: 60_000,
  jitterRatio: 0.25,
}

export function isRetryable(err: LLMError): boolean {
  switch (err.kind) {
    case 'rate-limited':
    case 'network':
      return true
    case 'unknown':
      return true
    case 'invalid-response':
    case 'authentication':
    case 'context-overflow':
    case 'aborted':
    case 'budget-exceeded':
      return false
  }
}

export function computeBackoffMs(
  attempt: number,
  config: RetryConfig = DEFAULT_RETRY,
  rng: () => number = Math.random,
): number {
  const exponential = Math.min(config.maxDelayMs, config.baseDelayMs * Math.pow(2, attempt))
  const jitter = exponential * config.jitterRatio * rng()
  return Math.min(config.maxDelayMs, exponential + jitter)
}

export type RetryDeps = {
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>
  rng?: () => number
}

export async function retryWithBackoff<T>(
  fn: (attempt: number) => Promise<{ ok: true; value: T } | { ok: false; error: LLMError }>,
  deps: RetryDeps,
  config: RetryConfig = DEFAULT_RETRY,
  signal?: AbortSignal,
): Promise<{ ok: true; value: T; attempts: number } | { ok: false; error: LLMError; attempts: number }> {
  let lastError: LLMError = { kind: 'unknown', message: 'no attempts made' }
  for (let attempt = 0; attempt <= config.maxRetries; attempt += 1) {
    if (signal?.aborted) {
      return { ok: false, error: { kind: 'aborted' }, attempts: attempt }
    }
    const result = await fn(attempt)
    if (result.ok) {
      return { ok: true, value: result.value, attempts: attempt }
    }
    lastError = result.error
    if (!isRetryable(result.error) || attempt === config.maxRetries) {
      return { ok: false, error: lastError, attempts: attempt }
    }
    const delay =
      result.error.kind === 'rate-limited' && result.error.retryAfterMs > 0
        ? Math.min(config.maxDelayMs, result.error.retryAfterMs)
        : computeBackoffMs(attempt, config, deps.rng)
    await deps.sleep(delay, signal)
  }
  return { ok: false, error: lastError, attempts: config.maxRetries }
}

export function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(new DOMException('Aborted', 'AbortError'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}
