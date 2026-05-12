import type { CostCeiling, LLMError } from './types'

type Snapshot = Readonly<CostCeiling>

const EPSILON = 1e-9

export class BudgetExceededError extends Error {
  readonly kind = 'budget-exceeded' as const
  readonly reservedUsd: number
  readonly ceilingUsd: number

  constructor(reservedUsd: number, ceilingUsd: number) {
    super(`Budget ceiling exceeded: reserved ${reservedUsd} > ceiling ${ceilingUsd}`)
    this.reservedUsd = reservedUsd
    this.ceilingUsd = ceilingUsd
  }

  toLLMError(): LLMError {
    return {
      kind: 'budget-exceeded',
      reservedUsd: this.reservedUsd,
      ceilingUsd: this.ceilingUsd,
    }
  }
}

export class CostMeter {
  private ceilingUsd: number
  private reservedUsd: number
  private billedUsd: number

  constructor(ceilingUsd: number) {
    if (!Number.isFinite(ceilingUsd) || ceilingUsd < 0) {
      throw new Error(`Invalid ceilingUsd: ${ceilingUsd}`)
    }
    this.ceilingUsd = ceilingUsd
    this.reservedUsd = 0
    this.billedUsd = 0
  }

  snapshot(): Snapshot {
    return {
      ceilingUsd: this.ceilingUsd,
      reservedUsd: this.reservedUsd,
      billedUsd: this.billedUsd,
    }
  }

  setCeiling(ceilingUsd: number): void {
    if (!Number.isFinite(ceilingUsd) || ceilingUsd < 0) {
      throw new Error(`Invalid ceilingUsd: ${ceilingUsd}`)
    }
    this.ceilingUsd = ceilingUsd
  }

  reserve(estimateUsd: number): void {
    if (!Number.isFinite(estimateUsd) || estimateUsd < 0) {
      throw new Error(`Invalid estimateUsd: ${estimateUsd}`)
    }
    const nextReserved = this.reservedUsd + estimateUsd
    if (nextReserved + this.billedUsd > this.ceilingUsd + EPSILON) {
      throw new BudgetExceededError(nextReserved + this.billedUsd, this.ceilingUsd)
    }
    this.reservedUsd = nextReserved
  }

  commit(estimateUsd: number, actualUsd: number): void {
    if (!Number.isFinite(estimateUsd) || estimateUsd < 0) {
      throw new Error(`Invalid estimateUsd: ${estimateUsd}`)
    }
    if (!Number.isFinite(actualUsd) || actualUsd < 0) {
      throw new Error(`Invalid actualUsd: ${actualUsd}`)
    }
    this.reservedUsd = Math.max(0, this.reservedUsd - estimateUsd)
    this.billedUsd = this.billedUsd + actualUsd
  }

  cancel(estimateUsd: number): void {
    if (!Number.isFinite(estimateUsd) || estimateUsd < 0) {
      throw new Error(`Invalid estimateUsd: ${estimateUsd}`)
    }
    this.reservedUsd = Math.max(0, this.reservedUsd - estimateUsd)
  }

  remaining(): number {
    return Math.max(0, this.ceilingUsd - this.reservedUsd - this.billedUsd)
  }
}
