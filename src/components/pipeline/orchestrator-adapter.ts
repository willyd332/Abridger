import type { Provider } from '@/llm/types'
import type { PhaseEvent } from '@/pipeline/types'
import type { FrontBackMatterHandling } from '@/state'

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

export type RunCompletion =
  | { ok: true; outputs: { abridged: Blob; ledger: Blob; abridgedMimeType: string } }
  | { ok: false; reason: string; message: string }

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

type OrchestratorModule = {
  startRun?: (input: StartRunInput) => Promise<StartRunResult>
  resumeRun?: (runId: string) => Promise<StartRunResult>
}

async function loadOrchestrator(): Promise<OrchestratorModule | null> {
  try {
    const mod = (await import('@/pipeline/orchestrator')) as OrchestratorModule
    return mod
  } catch {
    return null
  }
}

export async function startRun(input: StartRunInput): Promise<StartRunResult> {
  const mod = await loadOrchestrator()
  if (!mod?.startRun) {
    return {
      ok: false,
      reason: 'not-implemented',
      message:
        'The orchestrator is not yet wired into this build. Pipeline execution will start once Wave 6A lands.',
    }
  }
  return mod.startRun(input)
}

export async function resumeRun(runId: string): Promise<StartRunResult> {
  const mod = await loadOrchestrator()
  if (!mod?.resumeRun) {
    return {
      ok: false,
      reason: 'not-implemented',
      message:
        'The orchestrator is not yet wired into this build. Resume will work once Wave 6A lands.',
    }
  }
  return mod.resumeRun(runId)
}
