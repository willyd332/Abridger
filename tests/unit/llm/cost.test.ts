import { describe, it, expect } from 'vitest'
import { CostMeter, BudgetExceededError } from '@/llm/cost'

describe('CostMeter', () => {
  it('starts with zero reserved and billed', () => {
    const meter = new CostMeter(5)
    expect(meter.snapshot()).toEqual({
      ceilingUsd: 5,
      reservedUsd: 0,
      billedUsd: 0,
    })
  })

  it('reserve increments reservedUsd', () => {
    const meter = new CostMeter(5)
    meter.reserve(1.5)
    meter.reserve(0.5)
    expect(meter.snapshot().reservedUsd).toBe(2)
  })

  it('commit decrements reserved by estimate and increments billed by actual', () => {
    const meter = new CostMeter(10)
    meter.reserve(2)
    meter.commit(2, 1.5)
    expect(meter.snapshot()).toEqual({
      ceilingUsd: 10,
      reservedUsd: 0,
      billedUsd: 1.5,
    })
  })

  it('cancel decrements reserved without billing', () => {
    const meter = new CostMeter(10)
    meter.reserve(2)
    meter.cancel(2)
    expect(meter.snapshot()).toEqual({
      ceilingUsd: 10,
      reservedUsd: 0,
      billedUsd: 0,
    })
  })

  it('throws BudgetExceededError when reserve would breach ceiling', () => {
    const meter = new CostMeter(5)
    meter.reserve(3)
    expect(() => meter.reserve(2.5)).toThrow(BudgetExceededError)
  })

  it('counts billed usage against the ceiling', () => {
    const meter = new CostMeter(5)
    meter.reserve(3)
    meter.commit(3, 3) // billed = 3
    meter.reserve(1)
    expect(() => meter.reserve(1.5)).toThrow(BudgetExceededError)
  })

  it('race-safe: two concurrent reserves that together exceed ceiling reject one', async () => {
    const meter = new CostMeter(1)
    // Simulate concurrent reserves with microtask ordering
    const results = await Promise.all([
      Promise.resolve().then(() => {
        try {
          meter.reserve(0.7)
          return 'ok'
        } catch {
          return 'rejected'
        }
      }),
      Promise.resolve().then(() => {
        try {
          meter.reserve(0.7)
          return 'ok'
        } catch {
          return 'rejected'
        }
      }),
    ])
    expect(results.filter((r) => r === 'ok')).toHaveLength(1)
    expect(results.filter((r) => r === 'rejected')).toHaveLength(1)
  })

  it('cancel does not go negative', () => {
    const meter = new CostMeter(5)
    meter.cancel(2)
    expect(meter.snapshot().reservedUsd).toBe(0)
  })

  it('remaining reflects ceiling minus reserved minus billed', () => {
    const meter = new CostMeter(5)
    meter.reserve(1)
    meter.commit(1, 1)
    meter.reserve(1)
    expect(meter.remaining()).toBeCloseTo(3, 5)
  })

  it('toLLMError surfaces budget-exceeded shape', () => {
    const meter = new CostMeter(1)
    try {
      meter.reserve(2)
    } catch (err) {
      expect(err).toBeInstanceOf(BudgetExceededError)
      expect((err as BudgetExceededError).toLLMError()).toEqual({
        kind: 'budget-exceeded',
        reservedUsd: 2,
        ceilingUsd: 1,
      })
    }
  })

  it('rejects negative or non-finite values', () => {
    const meter = new CostMeter(5)
    expect(() => meter.reserve(-1)).toThrow()
    expect(() => meter.reserve(Number.NaN)).toThrow()
    expect(() => new CostMeter(-1)).toThrow()
  })

  it('setCeiling adjusts the ceiling', () => {
    const meter = new CostMeter(5)
    meter.setCeiling(10)
    expect(meter.snapshot().ceilingUsd).toBe(10)
  })
})
