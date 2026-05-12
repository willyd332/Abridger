import type { Provider } from '@/llm/types'
import type { PhaseEvent } from '@/pipeline/types'
import type { FrontBackMatterHandling } from '@/state'
import type {
  StartRunInput as OrchestratorStartRunInput,
  StartRunResult as OrchestratorStartRunResult,
  RunHandle as OrchestratorRunHandle,
  RunCompletion as OrchestratorRunCompletion,
} from '@/pipeline/orchestrator'

export type StartRunInput = {
  file: File
  apiKey: string
  provider: Provider
  purpose: string
  storeKeyLocally: boolean
  costCeiling: number
  frontBackMatterHandling: FrontBackMatterHandling
  password?: string
}

export type RunCompletion = OrchestratorRunCompletion

export type RunHandle = {
  runId: string
  cancel: () => void
  pause: () => void | Promise<void>
  resume?: () => void | Promise<void>
  onEvent: (listener: (event: PhaseEvent) => void) => () => void
  result?: Promise<RunCompletion>
}

export type StartRunReason =
  | 'drm-protected'
  | 'password-required'
  | 'no-text-layer'
  | 'corrupt'
  | 'unsupported-format'
  | 'unknown'
  | 'budget-too-low'
  | 'unsupported'
  | 'invalid-key'
  | 'pinning-mismatch'
  | 'not-implemented'

export type StartRunResult =
  | { ok: true; handle: RunHandle }
  | { ok: false; reason: StartRunReason; message: string }

function adaptHandle(h: OrchestratorRunHandle): RunHandle {
  return {
    runId: h.runId,
    cancel: h.cancel,
    pause: h.pause,
    onEvent: h.onEvent,
    result: h.result,
  }
}

function adaptResult(r: OrchestratorStartRunResult): StartRunResult {
  if (r.ok) return { ok: true, handle: adaptHandle(r.handle) }
  return { ok: false, reason: r.reason as StartRunReason, message: r.message }
}

export async function startRun(input: StartRunInput): Promise<StartRunResult> {
  const mod = await import('@/pipeline/orchestrator')
  const orchestratorInput: OrchestratorStartRunInput = { ...input }
  const result = await mod.startRun(orchestratorInput)
  return adaptResult(result)
}

export async function resumeRun(runId: string): Promise<StartRunResult> {
  const mod = await import('@/pipeline/orchestrator')
  const result = await mod.resumeRun(runId)
  return adaptResult(result)
}
