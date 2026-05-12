import { createStore, type StoreApi } from 'zustand/vanilla'
import { useStore } from 'zustand'

import type { CostCeiling } from '@/llm/types'

import { books, runs, sections } from './persistence'
import type {
  BookRecord,
  NewRun,
  RunRecord,
  SectionRecord,
} from './types'

export type IntakeState = {
  file: File | null
  key: string
  purpose: string
  storeKeyLocally: boolean
}

export type JobView = {
  run: RunRecord
  book: BookRecord | null
  sections: SectionRecord[]
}

export type AppState = {
  currentRunId: string | null
  job: JobView | null
  cost: CostCeiling
  intake: IntakeState
  setIntake: (patch: Partial<IntakeState>) => void
  beginRun: (
    args: {
      run: NewRun
      book: BookRecord
      sections: SectionRecord[]
    },
  ) => Promise<void>
  pauseRun: () => Promise<void>
  resumeRun: (runId: string) => Promise<void>
  cancelRun: () => Promise<void>
  refreshFromDB: () => Promise<void>
  setCurrentRunId: (runId: string | null) => void
}

const DEFAULT_INTAKE: IntakeState = {
  file: null,
  key: '',
  purpose: '',
  storeKeyLocally: false,
}

const DEFAULT_COST: CostCeiling = {
  ceilingUsd: 0,
  reservedUsd: 0,
  billedUsd: 0,
}

export function createAppStore(): StoreApi<AppState> {
  return createStore<AppState>()((set, get) => ({
    currentRunId: null,
    job: null,
    cost: DEFAULT_COST,
    intake: DEFAULT_INTAKE,

    setIntake(patch) {
      set((state) => ({ intake: { ...state.intake, ...patch } }))
    },

    setCurrentRunId(runId) {
      set({ currentRunId: runId })
    },

    async beginRun({ run, book, sections: sectionRecords }) {
      const created = await runs.create(run)
      await books.create(book)
      for (const record of sectionRecords) {
        await sections.create(record)
      }
      const job: JobView = {
        run: created,
        book,
        sections: [...sectionRecords].sort((a, b) => a.order - b.order),
      }
      set({
        currentRunId: created.runId,
        job,
        cost: created.cost,
      })
    },

    async pauseRun() {
      const runId = get().currentRunId
      if (!runId) return
      const updated = await runs.update(runId, { status: 'paused' })
      set((state) => ({
        cost: updated.cost,
        job: state.job ? { ...state.job, run: updated } : null,
      }))
    },

    async resumeRun(runId) {
      const updated = await runs.update(runId, { status: 'in_progress' })
      const book = await books.getByRun(runId)
      const sectionList = await sections.listByRun(runId)
      const job: JobView = {
        run: updated,
        book,
        sections: sectionList,
      }
      set({
        currentRunId: runId,
        job,
        cost: updated.cost,
      })
    },

    async cancelRun() {
      const runId = get().currentRunId
      if (!runId) return
      const updated = await runs.update(runId, { status: 'cancelled' })
      set((state) => ({
        cost: updated.cost,
        job: state.job ? { ...state.job, run: updated } : null,
      }))
    },

    async refreshFromDB() {
      const runId = get().currentRunId
      if (!runId) {
        set({ job: null, cost: DEFAULT_COST })
        return
      }
      const run = await runs.get(runId)
      if (!run) {
        set({ job: null, cost: DEFAULT_COST, currentRunId: null })
        return
      }
      const book = await books.getByRun(runId)
      const sectionList = await sections.listByRun(runId)
      set({
        job: { run, book, sections: sectionList },
        cost: run.cost,
      })
    },
  }))
}

const sharedStore: StoreApi<AppState> = createAppStore()

export function getAppStore(): StoreApi<AppState> {
  return sharedStore
}

const identitySelector = (state: AppState): AppState => state

export function useAppStore<T>(selector: (state: AppState) => T = identitySelector as (state: AppState) => T): T {
  return useStore(sharedStore, selector)
}

export type MemoryPressureSnapshot = {
  available: boolean
  usedJsHeapSize?: number
  totalJsHeapSize?: number
  jsHeapSizeLimit?: number
  pressureRatio?: number
}

type PerformanceMemoryShape = {
  usedJSHeapSize: number
  totalJSHeapSize: number
  jsHeapSizeLimit: number
}

export function inspectMemoryPressure(): MemoryPressureSnapshot {
  const perf = globalThis.performance as unknown as { memory?: PerformanceMemoryShape } | undefined
  const memory = perf?.memory
  if (!memory) {
    return { available: false }
  }
  const usedJsHeapSize = memory.usedJSHeapSize
  const totalJsHeapSize = memory.totalJSHeapSize
  const jsHeapSizeLimit = memory.jsHeapSizeLimit
  const pressureRatio =
    jsHeapSizeLimit > 0 ? usedJsHeapSize / jsHeapSizeLimit : undefined
  return {
    available: true,
    usedJsHeapSize,
    totalJsHeapSize,
    jsHeapSizeLimit,
    pressureRatio,
  }
}
