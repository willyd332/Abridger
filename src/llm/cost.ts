import type { CostCeiling, LLMError } from './types'

export type CostMeterSnapshot = CostCeiling & {
  promptTokensTotal: number
  completionTokensTotal: number
  callsCompleted: number
  callsFailed: number
}

type Snapshot = Readonly<CostMeterSnapshot>

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

type PendingWaiter = {
  estimate: number
  resolve: () => void
  reject: (err: BudgetExceededError) => void
  signal?: AbortSignal
  onAbort?: () => void
}

export type CostMeterPauseHandler = (paused: boolean, snapshot: Snapshot) => void

export class CostMeter {
  private ceilingUsd: number
  private reservedUsd: number
  private billedUsd: number
  private promptTokensTotal = 0
  private completionTokensTotal = 0
  private callsCompleted = 0
  private callsFailed = 0
  // Calls that would exceed the ceiling wait here instead of throwing. They
  // resolve when setCeiling() opens up capacity, and reject if
  // cancelAllPending() is called (user chose "Stop here").
  private pendingWaiters: PendingWaiter[] = []
  private onPauseStateChange?: CostMeterPauseHandler

  constructor(ceilingUsd: number) {
    if (!Number.isFinite(ceilingUsd) || ceilingUsd < 0) {
      throw new Error(`Invalid ceilingUsd: ${ceilingUsd}`)
    }
    this.ceilingUsd = ceilingUsd
    this.reservedUsd = 0
    this.billedUsd = 0
  }

  setPauseHandler(fn?: CostMeterPauseHandler): void {
    this.onPauseStateChange = fn
  }

  private canFit(estimate: number): boolean {
    return (
      this.reservedUsd + estimate + this.billedUsd <=
      this.ceilingUsd + EPSILON
    )
  }

  // Non-throwing async reservation: resolves immediately if there is room,
  // otherwise queues the call until setCeiling() makes room or
  // cancelAllPending() rejects it. Used by LLMClient so a budget hit causes
  // a pause-and-wait instead of a hard failure.
  async reserveOrWait(estimate: number, signal?: AbortSignal): Promise<void> {
    if (!Number.isFinite(estimate) || estimate < 0) {
      throw new Error(`Invalid estimateUsd: ${estimate}`)
    }
    if (this.canFit(estimate)) {
      this.reservedUsd += estimate
      return
    }
    return new Promise<void>((resolve, reject) => {
      const waiter: PendingWaiter = { estimate, resolve, reject, signal }
      const wasEmpty = this.pendingWaiters.length === 0
      this.pendingWaiters.push(waiter)
      if (signal) {
        const onAbort = (): void => {
          this.pendingWaiters = this.pendingWaiters.filter((w) => w !== waiter)
          reject(
            new BudgetExceededError(
              this.reservedUsd + this.billedUsd + estimate,
              this.ceilingUsd,
            ),
          )
          if (this.pendingWaiters.length === 0) {
            this.onPauseStateChange?.(false, this.snapshot())
          }
        }
        waiter.onAbort = onAbort
        signal.addEventListener('abort', onAbort, { once: true })
      }
      if (wasEmpty) {
        this.onPauseStateChange?.(true, this.snapshot())
      }
    })
  }

  isPaused(): boolean {
    return this.pendingWaiters.length > 0
  }

  pendingCount(): number {
    return this.pendingWaiters.length
  }

  private drainPending(): void {
    while (this.pendingWaiters.length > 0) {
      const next = this.pendingWaiters[0]
      if (this.canFit(next.estimate)) {
        this.reservedUsd += next.estimate
        this.pendingWaiters.shift()
        if (next.onAbort && next.signal) {
          next.signal.removeEventListener('abort', next.onAbort)
        }
        next.resolve()
      } else {
        break
      }
    }
    if (this.pendingWaiters.length === 0) {
      this.onPauseStateChange?.(false, this.snapshot())
    }
  }

  cancelAllPending(): void {
    const waiters = this.pendingWaiters
    this.pendingWaiters = []
    for (const w of waiters) {
      if (w.onAbort && w.signal) {
        w.signal.removeEventListener('abort', w.onAbort)
      }
      w.reject(
        new BudgetExceededError(
          this.reservedUsd + this.billedUsd + w.estimate,
          this.ceilingUsd,
        ),
      )
    }
    this.onPauseStateChange?.(false, this.snapshot())
  }

  snapshot(): Snapshot {
    return {
      ceilingUsd: this.ceilingUsd,
      reservedUsd: this.reservedUsd,
      billedUsd: this.billedUsd,
      promptTokensTotal: this.promptTokensTotal,
      completionTokensTotal: this.completionTokensTotal,
      callsCompleted: this.callsCompleted,
      callsFailed: this.callsFailed,
    }
  }

  recordCallCompleted(promptTokens: number, completionTokens: number): void {
    this.promptTokensTotal += promptTokens
    this.completionTokensTotal += completionTokens
    this.callsCompleted += 1
  }

  recordCallFailed(): void {
    this.callsFailed += 1
  }

  setCeiling(ceilingUsd: number): void {
    if (!Number.isFinite(ceilingUsd) || ceilingUsd < 0) {
      throw new Error(`Invalid ceilingUsd: ${ceilingUsd}`)
    }
    this.ceilingUsd = ceilingUsd
    // New ceiling may have created enough headroom for queued waiters.
    if (this.pendingWaiters.length > 0) this.drainPending()
  }

  getCeiling(): number {
    return this.ceilingUsd
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
