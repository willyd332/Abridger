export type {
  RunStatus,
  RouteName,
  FrontBackMatterHandling,
  PhaseStatusKind,
  PhaseStatus,
  PhaseName,
  SectionPhaseStatus,
  ModelMapping,
  PromptHashes,
  RunRecord,
  NewRun,
  BookRecord,
  SectionRecord,
  SpineRecord,
  BracketKind,
  BracketRecord,
  OutputKind,
  OutputRecord,
  EventRecord,
} from './types'
export { PHASE_NAMES, defaultPhaseStatus, defaultSectionPhaseStatus } from './types'

export { DB_NAME, DB_VERSION, getDb, closeDb, resetDbForTests } from './db'
export type { AbridgerDb, AbridgerSchema } from './db'

export { runs, books, sections, spine, brackets, outputs, events } from './persistence'

export {
  findResumableRun,
  reapOrphans,
  verifyPinning,
  verifyPinningAgainst,
  summarizeRun,
  hashPromptBody,
  buildPromptHashes,
  listPhaseNames,
  ORPHAN_THRESHOLD_MS,
} from './resume'
export type {
  ResumableRunSummary,
  ResumableRunMatch,
  OrphanReapResult,
  PinningMismatch,
  VerifyPinningResult,
  PinningSnapshot,
} from './resume'

export {
  createAppStore,
  getAppStore,
  useAppStore,
  inspectMemoryPressure,
} from './store'
export type {
  AppState,
  IntakeState,
  JobView,
  MemoryPressureSnapshot,
  ActivityEntry,
  TokenTotals,
} from './store'

export {
  selectCurrentRun,
  selectSections,
  selectCostRemaining,
  selectCostUsedRatio,
  selectInFlightSections,
  selectSectionsByPhaseStatus,
  selectCurrentPhase,
  selectIsResumable,
  selectProgress,
  selectTotalBilled,
  selectReserved,
} from './selectors'
