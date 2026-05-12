import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  computeBackoffMs,
  retryWithBackoff,
  isRetryable,
  DEFAULT_RETRY,
} from '@/llm/retry'
import type { LLMError } from '@/llm/types'

describe('retry', () => {
  describe('isRetryable', () => {
    it('retries rate-limited, network, unknown', () => {
      expect(isRetryable({ kind: 'rate-limited', retryAfterMs: 100 })).toBe(true)
      expect(isRetryable({ kind: 'network', message: 'fail' })).toBe(true)
      expect(isRetryable({ kind: 'unknown', message: 'fail' })).toBe(true)
    })

    it('does not retry auth, context-overflow, aborted, budget-exceeded, invalid-response', () => {
      expect(isRetryable({ kind: 'authentication', message: 'x' })).toBe(false)
      expect(isRetryable({ kind: 'context-overflow', message: 'x' })).toBe(false)
      expect(isRetryable({ kind: 'aborted' })).toBe(false)
      expect(isRetryable({ kind: 'budget-exceeded', reservedUsd: 1, ceilingUsd: 0 })).toBe(false)
      expect(isRetryable({ kind: 'invalid-response', message: 'x' })).toBe(false)
    })
  })

  describe('computeBackoffMs', () => {
    it('grows exponentially from baseDelayMs * 2^attempt', () => {
      const rng = (): number => 0
      expect(computeBackoffMs(0, DEFAULT_RETRY, rng)).toBe(500)
      expect(computeBackoffMs(1, DEFAULT_RETRY, rng)).toBe(1000)
      expect(computeBackoffMs(2, DEFAULT_RETRY, rng)).toBe(2000)
      expect(computeBackoffMs(3, DEFAULT_RETRY, rng)).toBe(4000)
    })

    it('caps at maxDelayMs', () => {
      const rng = (): number => 1
      expect(computeBackoffMs(20, DEFAULT_RETRY, rng)).toBe(60_000)
    })

    it('adds jitter when rng > 0', () => {
      const rng = (): number => 0.5
      const v = computeBackoffMs(0, DEFAULT_RETRY, rng)
      // 500 + 500 * 0.25 * 0.5 = 562.5
      expect(v).toBeCloseTo(562.5, 5)
    })
  })

  describe('retryWithBackoff', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    it('returns immediately on success', async () => {
      const sleep = vi.fn(async () => {})
      const result = await retryWithBackoff(
        async () => ({ ok: true, value: 42 }),
        { sleep },
      )
      expect(result).toEqual({ ok: true, value: 42, attempts: 0 })
      expect(sleep).not.toHaveBeenCalled()
    })

    it('retries retryable errors up to maxRetries', async () => {
      const sleep = vi.fn(async () => {})
      const err: LLMError = { kind: 'network', message: 'boom' }
      const fn = vi.fn(async () => ({ ok: false as const, error: err }))
      const result = await retryWithBackoff(fn, { sleep, rng: () => 0 })
      expect(result.ok).toBe(false)
      // 1 initial + 4 retries = 5 attempts
      expect(fn).toHaveBeenCalledTimes(5)
      // sleep called between attempts (4 times)
      expect(sleep).toHaveBeenCalledTimes(4)
    })

    it('stops immediately on non-retryable error', async () => {
      const sleep = vi.fn(async () => {})
      const err: LLMError = { kind: 'authentication', message: 'bad key' }
      const fn = vi.fn(async () => ({ ok: false as const, error: err }))
      const result = await retryWithBackoff(fn, { sleep })
      expect(result.ok).toBe(false)
      expect(fn).toHaveBeenCalledTimes(1)
      expect(sleep).not.toHaveBeenCalled()
    })

    it('honors retryAfterMs from rate-limited error', async () => {
      const sleep = vi.fn(async () => {})
      let attemptCount = 0
      const fn = vi.fn(async () => {
        attemptCount += 1
        if (attemptCount < 2) {
          return {
            ok: false as const,
            error: { kind: 'rate-limited', retryAfterMs: 1234 } as LLMError,
          }
        }
        return { ok: true as const, value: 'done' }
      })
      const result = await retryWithBackoff(fn, { sleep, rng: () => 0 })
      expect(result).toEqual({ ok: true, value: 'done', attempts: 1 })
      expect(sleep).toHaveBeenCalledWith(1234, undefined)
    })

    it('aborts when signal is already aborted', async () => {
      const sleep = vi.fn(async () => {})
      const controller = new AbortController()
      controller.abort()
      const fn = vi.fn(async () => ({ ok: true as const, value: 'x' }))
      const result = await retryWithBackoff(fn, { sleep }, DEFAULT_RETRY, controller.signal)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toEqual({ kind: 'aborted' })
      }
      expect(fn).not.toHaveBeenCalled()
    })

    it('uses fake timers with computed backoff schedule', async () => {
      const delays: number[] = []
      const sleep = async (ms: number): Promise<void> => {
        delays.push(ms)
      }
      const err: LLMError = { kind: 'network', message: 'boom' }
      const fn = vi.fn(async () => ({ ok: false as const, error: err }))
      await retryWithBackoff(fn, { sleep, rng: () => 0 }, DEFAULT_RETRY)
      expect(delays).toEqual([500, 1000, 2000, 4000])
    })
  })
})
