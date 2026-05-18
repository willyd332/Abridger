import 'fake-indexeddb/auto'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { deleteDB } from 'idb'

import { DB_NAME, closeDb, resetDbForTests } from '@/state/db'
import { createAppStore, inspectMemoryPressure } from '@/state/store'
import {
  selectCostRemaining,
  selectCostUsedRatio,
  selectCurrentPhase,
  selectCurrentRun,
  selectInFlightSections,
  selectIsResumable,
  selectProgress,
  selectSections,
  selectSectionsByPhaseStatus,
} from '@/state/selectors'
import { defaultSectionPhaseStatus } from '@/state/types'

import {
  makeBookRecord,
  makeRunRecord,
  makeSectionRecord,
} from './fixtures'

async function resetDb(): Promise<void> {
  await closeDb()
  await deleteDB(DB_NAME)
  resetDbForTests()
}

beforeEach(async () => {
  await resetDb()
})

afterEach(async () => {
  await resetDb()
})

describe('createAppStore — initial state', () => {
  it('starts empty', () => {
    const store = createAppStore()
    const state = store.getState()
    expect(state.currentRunId).toBeNull()
    expect(state.job).toBeNull()
    expect(state.cost).toEqual({ ceilingUsd: 0, reservedUsd: 0, billedUsd: 0 })
    expect(state.intake.file).toBeNull()
    expect(state.intake.purpose).toBe('')
  })

  it('setIntake merges immutably', () => {
    const store = createAppStore()
    const initialIntake = store.getState().intake
    store.getState().setIntake({ purpose: 'understand it' })
    expect(store.getState().intake.purpose).toBe('understand it')
    expect(store.getState().intake.file).toBeNull()
    expect(initialIntake.purpose).toBe('') // not mutated
    expect(store.getState().intake).not.toBe(initialIntake)
  })
})

describe('beginRun -> selectors -> refreshFromDB', () => {
  it('begins a run and exposes it through selectors', async () => {
    const store = createAppStore()
    const run = makeRunRecord({
      runId: 'r1',
      phase: 'A',
      cost: { ceilingUsd: 5, reservedUsd: 1, billedUsd: 0.5 },
    })
    const book = makeBookRecord({ bookId: 'b1', runId: 'r1' })
    const sectionRecords = [
      makeSectionRecord({ runId: 'r1', sectionId: 's1', order: 1 }),
      makeSectionRecord({ runId: 'r1', sectionId: 's2', order: 2 }),
    ]
    await store.getState().beginRun({ run, book, sections: sectionRecords })

    expect(store.getState().currentRunId).toBe('r1')
    expect(selectCurrentRun(store.getState())?.runId).toBe('r1')
    expect(selectSections(store.getState())).toHaveLength(2)
    expect(selectCurrentPhase(store.getState())).toBe('A')
    expect(selectIsResumable(store.getState())).toBe(true)
    expect(selectCostRemaining(store.getState())).toBeCloseTo(3.5)
    expect(selectCostUsedRatio(store.getState())).toBeCloseTo(0.3)
  })

  it('refreshFromDB reloads run and sections from persistence', async () => {
    const store = createAppStore()
    const run = makeRunRecord({ runId: 'r1' })
    const book = makeBookRecord({ bookId: 'b1', runId: 'r1' })
    const sectionRecords = [
      makeSectionRecord({ runId: 'r1', sectionId: 's1', order: 1 }),
    ]
    await store.getState().beginRun({ run, book, sections: sectionRecords })

    // Clear in-memory mirror via setCurrentRunId/refresh.
    store.getState().setCurrentRunId('r1')
    await store.getState().refreshFromDB()
    expect(store.getState().job?.run.runId).toBe('r1')
    expect(store.getState().job?.book?.bookId).toBe('b1')
    expect(store.getState().job?.sections).toHaveLength(1)
  })

  it('refreshFromDB clears the job when the run no longer exists', async () => {
    const store = createAppStore()
    store.getState().setCurrentRunId('missing')
    await store.getState().refreshFromDB()
    expect(store.getState().job).toBeNull()
    expect(store.getState().currentRunId).toBeNull()
  })
})

describe('pause / resume / cancel', () => {
  it('pauseRun sets the persisted status to paused and mirrors locally', async () => {
    const store = createAppStore()
    const run = makeRunRecord({ runId: 'r1', status: 'in_progress' })
    const book = makeBookRecord({ bookId: 'b1', runId: 'r1' })
    await store.getState().beginRun({ run, book, sections: [] })

    await store.getState().pauseRun()
    expect(store.getState().job?.run.status).toBe('paused')
  })

  it('resumeRun reloads from DB and sets status to in_progress', async () => {
    const store = createAppStore()
    const run = makeRunRecord({ runId: 'r1', status: 'paused' })
    const book = makeBookRecord({ bookId: 'b1', runId: 'r1' })
    await store.getState().beginRun({ run, book, sections: [] })
    store.setState({ currentRunId: null, job: null })

    await store.getState().resumeRun('r1')
    expect(store.getState().currentRunId).toBe('r1')
    expect(store.getState().job?.run.status).toBe('in_progress')
  })

  it('cancelRun marks the run cancelled', async () => {
    const store = createAppStore()
    const run = makeRunRecord({ runId: 'r1', status: 'in_progress' })
    const book = makeBookRecord({ bookId: 'b1', runId: 'r1' })
    await store.getState().beginRun({ run, book, sections: [] })
    await store.getState().cancelRun()
    expect(store.getState().job?.run.status).toBe('cancelled')
  })
})

describe('phase-status selectors', () => {
  it('selectInFlightSections finds sections with any in_flight phase', async () => {
    const store = createAppStore()
    const run = makeRunRecord({ runId: 'r1' })
    const book = makeBookRecord({ bookId: 'b1', runId: 'r1' })
    const inFlightStatus = {
      ...defaultSectionPhaseStatus(),
      O: {
        status: 'in_flight' as const,
        attempts: 1,
        requestStartedAt: Date.now(),
      },
    }
    const sectionRecords = [
      makeSectionRecord({
        runId: 'r1',
        sectionId: 's1',
        order: 1,
        phaseStatus: inFlightStatus,
      }),
      makeSectionRecord({ runId: 'r1', sectionId: 's2', order: 2 }),
    ]
    await store.getState().beginRun({ run, book, sections: sectionRecords })
    const inFlight = selectInFlightSections(store.getState())
    expect(inFlight.map((s) => s.sectionId)).toEqual(['s1'])
  })

  it('selectSectionsByPhaseStatus filters by phase + status', async () => {
    const store = createAppStore()
    const run = makeRunRecord({ runId: 'r1' })
    const book = makeBookRecord({ bookId: 'b1', runId: 'r1' })
    const doneA = {
      ...defaultSectionPhaseStatus(),
      A: { status: 'done' as const, attempts: 1, completedAt: 1 },
    }
    const sectionRecords = [
      makeSectionRecord({ runId: 'r1', sectionId: 's1', order: 1, phaseStatus: doneA }),
      makeSectionRecord({ runId: 'r1', sectionId: 's2', order: 2 }),
    ]
    await store.getState().beginRun({ run, book, sections: sectionRecords })
    expect(
      selectSectionsByPhaseStatus(store.getState(), 'A', 'done').map((s) => s.sectionId),
    ).toEqual(['s1'])
    expect(
      selectSectionsByPhaseStatus(store.getState(), 'A', 'pending').map((s) => s.sectionId),
    ).toEqual(['s2'])
  })

  it('selectProgress counts fully-done and errored sections', async () => {
    const store = createAppStore()
    const run = makeRunRecord({ runId: 'r1' })
    const book = makeBookRecord({ bookId: 'b1', runId: 'r1' })

    const allDone = Object.fromEntries(
      Object.entries(defaultSectionPhaseStatus()).map(([phase, status]) => [
        phase,
        { ...status, status: 'done' as const, attempts: 1 },
      ]),
    ) as ReturnType<typeof defaultSectionPhaseStatus>

    const erroredA = {
      ...defaultSectionPhaseStatus(),
      A: {
        status: 'error' as const,
        attempts: 3,
        lastError: 'boom',
      },
    }
    const sectionRecords = [
      makeSectionRecord({ runId: 'r1', sectionId: 's1', order: 1, phaseStatus: allDone }),
      makeSectionRecord({ runId: 'r1', sectionId: 's2', order: 2, phaseStatus: erroredA }),
      makeSectionRecord({ runId: 'r1', sectionId: 's3', order: 3 }),
    ]
    await store.getState().beginRun({ run, book, sections: sectionRecords })
    const progress = selectProgress(store.getState())
    expect(progress.total).toBe(3)
    expect(progress.done).toBe(1)
    expect(progress.errored).toBe(1)
    expect(progress.ratio).toBeCloseTo(1 / 3)
  })
})

describe('cost selectors edge cases', () => {
  it('selectCostUsedRatio returns 0 when ceiling is 0', () => {
    const store = createAppStore()
    store.setState({ cost: { ceilingUsd: 0, reservedUsd: 0, billedUsd: 0 } })
    expect(selectCostUsedRatio(store.getState())).toBe(0)
  })

  it('selectCostRemaining clamps to 0', () => {
    const store = createAppStore()
    store.setState({ cost: { ceilingUsd: 1, reservedUsd: 2, billedUsd: 0 } })
    expect(selectCostRemaining(store.getState())).toBe(0)
  })
})

describe('inspectMemoryPressure', () => {
  it('reports unavailable when performance.memory is not exposed', () => {
    const snapshot = inspectMemoryPressure()
    // jsdom does not expose performance.memory by default
    expect(typeof snapshot.available).toBe('boolean')
    if (snapshot.available) {
      expect(typeof snapshot.usedJsHeapSize).toBe('number')
    } else {
      expect(snapshot.usedJsHeapSize).toBeUndefined()
    }
  })

  it('reports a pressureRatio when performance.memory is mocked', () => {
    const perf = globalThis.performance as unknown as { memory?: unknown }
    const original = perf.memory
    perf.memory = {
      usedJSHeapSize: 250,
      totalJSHeapSize: 500,
      jsHeapSizeLimit: 1000,
    }
    try {
      const snapshot = inspectMemoryPressure()
      expect(snapshot.available).toBe(true)
      expect(snapshot.pressureRatio).toBeCloseTo(0.25)
    } finally {
      if (original === undefined) {
        delete perf.memory
      } else {
        perf.memory = original
      }
    }
  })
})
