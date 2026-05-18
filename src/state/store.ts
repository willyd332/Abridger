import { createStore, type StoreApi } from 'zustand/vanilla'
import { useStore } from 'zustand'

import type { CostCeiling } from '@/llm/types'
import type {
  NodeDependencies,
  OntologyTree,
} from '@/pipeline/ontology/types'

import {
  books,
  dependencies as dependenciesStore,
  inclusion as inclusionStore,
  ontology as ontologyStore,
  runs,
  sections,
} from './persistence'
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

export type CurateState = {
  tree: OntologyTree | null
  inclusion: Record<string, boolean>
  expanded: Record<string, boolean>
  selectedNodeId: string | null
  dependenciesCache: Record<string, NodeDependencies>
  preSuggestSnapshot: Record<string, boolean> | null
  suggestPending: boolean
}

export type JobView = {
  run: RunRecord
  book: BookRecord | null
  sections: SectionRecord[]
}

export type ActivityEntry = {
  id: string                    // requestId from LLMClient
  phase: string
  sectionId?: string
  role: 'cheap' | 'smart' | 'reasoning'
  model: string
  startedAt: number
  endedAt?: number
  status: 'in_flight' | 'done' | 'error' | 'retrying'
  attempt: number
  estimateUsd: number
  promptTokens?: number
  completionTokens?: number
  costUsd?: number
  errorMessage?: string
}

export type TokenTotals = {
  promptTokens: number
  completionTokens: number
  callsCompleted: number
  callsFailed: number
}

const DEFAULT_TOKEN_TOTALS: TokenTotals = {
  promptTokens: 0,
  completionTokens: 0,
  callsCompleted: 0,
  callsFailed: 0,
}

export type AppState = {
  currentRunId: string | null
  job: JobView | null
  cost: CostCeiling
  tokens: TokenTotals
  activityLog: ActivityEntry[]
  intake: IntakeState
  curate: CurateState
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
  setTokens: (totals: TokenTotals) => void
  pushActivity: (entry: ActivityEntry) => void
  patchActivity: (id: string, patch: Partial<ActivityEntry>) => void
  clearActivity: () => void
  setOntologyTree: (tree: OntologyTree | null) => Promise<void>
  setSelectedNode: (nodeId: string | null) => void
  toggleNodeInclusion: (nodeId: string) => Promise<void>
  setNodeInclusion: (nodeId: string, included: boolean) => Promise<void>
  setSubtreeInclusion: (nodeIds: string[], included: boolean) => Promise<void>
  setExpanded: (nodeId: string, expanded: boolean) => void
  setManyExpanded: (patch: Record<string, boolean>) => void
  storeDependencies: (deps: NodeDependencies) => Promise<void>
  applySuggestExclusions: (
    excludedLeafIds: string[],
  ) => Promise<void>
  revertSuggest: () => Promise<void>
  setSuggestPending: (pending: boolean) => void
  loadCurateFromDB: (runId: string) => Promise<void>
  resetCurate: () => void
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

const DEFAULT_CURATE: CurateState = {
  tree: null,
  inclusion: {},
  expanded: {},
  selectedNodeId: null,
  dependenciesCache: {},
  preSuggestSnapshot: null,
  suggestPending: false,
}

const MAX_ACTIVITY_ENTRIES = 200

export function createAppStore(): StoreApi<AppState> {
  return createStore<AppState>()((set, get) => ({
    currentRunId: null,
    job: null,
    cost: DEFAULT_COST,
    tokens: DEFAULT_TOKEN_TOTALS,
    activityLog: [],
    intake: DEFAULT_INTAKE,
    curate: DEFAULT_CURATE,

    setIntake(patch) {
      set((state) => ({ intake: { ...state.intake, ...patch } }))
    },

    setCurrentRunId(runId) {
      set({ currentRunId: runId })
    },

    setTokens(totals) {
      set({ tokens: totals })
    },

    pushActivity(entry) {
      set((state) => {
        const next = [entry, ...state.activityLog]
        if (next.length > MAX_ACTIVITY_ENTRIES) next.length = MAX_ACTIVITY_ENTRIES
        return { activityLog: next }
      })
    },

    patchActivity(id, patch) {
      set((state) => {
        const idx = state.activityLog.findIndex((e) => e.id === id)
        if (idx === -1) return {}
        const next = [...state.activityLog]
        next[idx] = { ...next[idx], ...patch }
        return { activityLog: next }
      })
    },

    clearActivity() {
      set({ activityLog: [], tokens: DEFAULT_TOKEN_TOTALS })
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

    async setOntologyTree(tree) {
      const runId = get().currentRunId
      if (tree && runId) {
        await ontologyStore.put({ runId, tree, storedAt: Date.now() })
        const existing = await inclusionStore.get(runId)
        if (!existing) {
          const initial: Record<string, boolean> = {}
          for (const id of tree.leafIdsInOrder) initial[id] = true
          await inclusionStore.put({
            runId,
            inclusion: initial,
            updatedAt: Date.now(),
          })
          set((state) => ({
            curate: { ...state.curate, tree, inclusion: initial },
          }))
        } else {
          set((state) => ({
            curate: { ...state.curate, tree, inclusion: existing.inclusion },
          }))
        }
      } else {
        set((state) => ({ curate: { ...state.curate, tree } }))
      }
    },

    setSelectedNode(nodeId) {
      set((state) => ({
        curate: { ...state.curate, selectedNodeId: nodeId },
      }))
    },

    async toggleNodeInclusion(nodeId) {
      const runId = get().currentRunId
      const tree = get().curate.tree
      if (!runId || !tree) return
      const leafIds = collectLeafIds(tree, nodeId)
      const inclusionMap = get().curate.inclusion
      const allIncluded = leafIds.every((id) => inclusionMap[id] !== false)
      const nextValue = !allIncluded
      const updated = await inclusionStore.update(runId, (current) => {
        const next = { ...current }
        for (const id of leafIds) next[id] = nextValue
        return next
      })
      set((state) => ({
        curate: { ...state.curate, inclusion: updated.inclusion },
      }))
    },

    async setNodeInclusion(nodeId, included) {
      const runId = get().currentRunId
      const tree = get().curate.tree
      if (!runId || !tree) return
      const leafIds = collectLeafIds(tree, nodeId)
      const updated = await inclusionStore.update(runId, (current) => {
        const next = { ...current }
        for (const id of leafIds) next[id] = included
        return next
      })
      set((state) => ({
        curate: { ...state.curate, inclusion: updated.inclusion },
      }))
    },

    async setSubtreeInclusion(nodeIds, included) {
      const runId = get().currentRunId
      const tree = get().curate.tree
      if (!runId || !tree) return
      const leafIds = new Set<string>()
      for (const id of nodeIds) {
        for (const lid of collectLeafIds(tree, id)) leafIds.add(lid)
      }
      const updated = await inclusionStore.update(runId, (current) => {
        const next = { ...current }
        for (const id of leafIds) next[id] = included
        return next
      })
      set((state) => ({
        curate: { ...state.curate, inclusion: updated.inclusion },
      }))
    },

    setExpanded(nodeId, expanded) {
      set((state) => ({
        curate: {
          ...state.curate,
          expanded: { ...state.curate.expanded, [nodeId]: expanded },
        },
      }))
    },

    setManyExpanded(patch) {
      set((state) => ({
        curate: {
          ...state.curate,
          expanded: { ...state.curate.expanded, ...patch },
        },
      }))
    },

    async storeDependencies(deps) {
      const runId = get().currentRunId
      if (!runId) return
      await dependenciesStore.put({
        runId,
        nodeId: deps.focalNodeId,
        result: deps,
      })
      set((state) => ({
        curate: {
          ...state.curate,
          dependenciesCache: {
            ...state.curate.dependenciesCache,
            [deps.focalNodeId]: deps,
          },
        },
      }))
    },

    async applySuggestExclusions(excludedLeafIds) {
      const runId = get().currentRunId
      if (!runId) return
      const snapshot = { ...get().curate.inclusion }
      const updated = await inclusionStore.update(runId, (current) => {
        const next = { ...current }
        for (const id of excludedLeafIds) next[id] = false
        return next
      })
      set((state) => ({
        curate: {
          ...state.curate,
          inclusion: updated.inclusion,
          preSuggestSnapshot: snapshot,
          suggestPending: false,
        },
      }))
    },

    async revertSuggest() {
      const runId = get().currentRunId
      const snapshot = get().curate.preSuggestSnapshot
      if (!runId || !snapshot) return
      const updated = await inclusionStore.update(runId, () => ({ ...snapshot }))
      set((state) => ({
        curate: {
          ...state.curate,
          inclusion: updated.inclusion,
          preSuggestSnapshot: null,
        },
      }))
    },

    setSuggestPending(pending) {
      set((state) => ({
        curate: { ...state.curate, suggestPending: pending },
      }))
    },

    async loadCurateFromDB(runId) {
      const treeRecord = await ontologyStore.get(runId)
      const inclusionRecord = await inclusionStore.get(runId)
      const depsRecords = await dependenciesStore.listByRun(runId)
      const dependenciesCache: Record<string, NodeDependencies> = {}
      for (const r of depsRecords) dependenciesCache[r.nodeId] = r.result
      set((state) => ({
        curate: {
          ...state.curate,
          tree: treeRecord?.tree ?? null,
          inclusion: inclusionRecord?.inclusion ?? {},
          dependenciesCache,
        },
      }))
    },

    resetCurate() {
      set({ curate: DEFAULT_CURATE })
    },
  }))
}

function collectLeafIds(tree: OntologyTree, nodeId: string): string[] {
  const out: string[] = []
  const stack = [nodeId]
  while (stack.length) {
    const id = stack.pop()!
    const node = tree.nodes[id]
    if (!node) continue
    if (node.isLeaf) out.push(node.id)
    else stack.push(...[...node.childIds].reverse())
  }
  return out
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
