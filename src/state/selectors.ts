import type { AppState, JobView } from './store'
import type { PhaseName, SectionRecord } from './types'
import { PHASE_NAMES } from './types'

export function selectCurrentRun(state: AppState): JobView['run'] | null {
  return state.job?.run ?? null
}

export function selectSections(state: AppState): SectionRecord[] {
  return state.job?.sections ?? []
}

export function selectCostRemaining(state: AppState): number {
  const { ceilingUsd, reservedUsd, billedUsd } = state.cost
  return Math.max(0, ceilingUsd - reservedUsd - billedUsd)
}

export function selectCostUsedRatio(state: AppState): number {
  const { ceilingUsd, reservedUsd, billedUsd } = state.cost
  if (ceilingUsd <= 0) return 0
  return Math.min(1, (reservedUsd + billedUsd) / ceilingUsd)
}

export function selectInFlightSections(state: AppState): SectionRecord[] {
  const sectionList = selectSections(state)
  return sectionList.filter((section) =>
    PHASE_NAMES.some((phase) => section.phaseStatus[phase]?.status === 'in_flight'),
  )
}

export function selectSectionsByPhaseStatus(
  state: AppState,
  phase: PhaseName,
  status: SectionRecord['phaseStatus'][PhaseName]['status'],
): SectionRecord[] {
  const sectionList = selectSections(state)
  return sectionList.filter((section) => section.phaseStatus[phase]?.status === status)
}

export function selectCurrentPhase(state: AppState): string | null {
  return state.job?.run?.phase ?? null
}

export function selectIsResumable(state: AppState): boolean {
  const run = selectCurrentRun(state)
  if (!run) return false
  return run.status === 'in_progress' || run.status === 'paused'
}

export function selectProgress(state: AppState): {
  total: number
  done: number
  errored: number
  ratio: number
} {
  const sectionList = selectSections(state)
  if (sectionList.length === 0) {
    return { total: 0, done: 0, errored: 0, ratio: 0 }
  }
  let done = 0
  let errored = 0
  for (const section of sectionList) {
    const allDone = PHASE_NAMES.every((phase) => {
      const s = section.phaseStatus[phase]?.status
      return s === 'done' || s === 'skipped'
    })
    const anyError = PHASE_NAMES.some((phase) => section.phaseStatus[phase]?.status === 'error')
    if (allDone) done += 1
    if (anyError) errored += 1
  }
  return {
    total: sectionList.length,
    done,
    errored,
    ratio: done / sectionList.length,
  }
}

export function selectTotalBilled(state: AppState): number {
  return state.cost.billedUsd
}

export function selectReserved(state: AppState): number {
  return state.cost.reservedUsd
}
