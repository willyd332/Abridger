import { runs, sections } from './persistence'
import { PHASE_NAMES } from './types'
import type {
  ModelMapping,
  PhaseName,
  PromptHashes,
  RunRecord,
  SectionRecord,
} from './types'

export const ORPHAN_THRESHOLD_MS = 5 * 60 * 1000

export type ResumableRunSummary = {
  runId: string
  status: RunRecord['status']
  phase: string
  updatedAt: number
  createdAt: number
  costBilledUsd: number
  costCeilingUsd: number
  purpose: string
}

export type ResumableRunMatch = {
  runId: string
  summary: ResumableRunSummary
  record: RunRecord
}

export async function findResumableRun(): Promise<ResumableRunMatch | null> {
  const inProgress = await runs.list({ status: 'in_progress' })
  const paused = await runs.list({ status: 'paused' })
  const candidates = [...inProgress, ...paused]
  if (candidates.length === 0) return null

  const sorted = [...candidates].sort((a, b) => b.updatedAt - a.updatedAt)
  const record = sorted[0]
  return {
    runId: record.runId,
    record,
    summary: summarizeRun(record),
  }
}

export function summarizeRun(record: RunRecord): ResumableRunSummary {
  return {
    runId: record.runId,
    status: record.status,
    phase: record.phase,
    updatedAt: record.updatedAt,
    createdAt: record.createdAt,
    costBilledUsd: record.cost.billedUsd,
    costCeilingUsd: record.cost.ceilingUsd,
    purpose: record.purpose,
  }
}

export type OrphanReapResult = {
  reaped: number
  reapedSectionIds: string[]
}

export async function reapOrphans(
  runId: string,
  options: { now?: number; thresholdMs?: number } = {},
): Promise<OrphanReapResult> {
  const now = options.now ?? Date.now()
  const threshold = options.thresholdMs ?? ORPHAN_THRESHOLD_MS
  const all = await sections.listByRun(runId)
  const reapedSectionIds: string[] = []

  for (const record of all) {
    const updated = reapRecord(record, now, threshold)
    if (updated !== record) {
      await sections.update(runId, record.sectionId, { phaseStatus: updated.phaseStatus })
      reapedSectionIds.push(record.sectionId)
    }
  }

  return { reaped: reapedSectionIds.length, reapedSectionIds }
}

function reapRecord(record: SectionRecord, now: number, threshold: number): SectionRecord {
  let changed = false
  const nextStatus = { ...record.phaseStatus }
  for (const phase of PHASE_NAMES) {
    const ps = nextStatus[phase]
    if (ps.status !== 'in_flight') continue
    if (ps.requestStartedAt === undefined) continue
    if (now - ps.requestStartedAt <= threshold) continue
    nextStatus[phase] = {
      ...ps,
      status: 'pending',
      lastError: 'orphan-reaped',
    }
    changed = true
  }
  if (!changed) return record
  return { ...record, phaseStatus: nextStatus }
}

export type PinningMismatch = {
  path: string
  expected: string
  actual: string
}

export type VerifyPinningResult = {
  ok: boolean
  mismatches: PinningMismatch[]
}

export async function verifyPinning(
  runId: string,
  currentModelMapping: ModelMapping,
  currentPromptHashes: PromptHashes,
): Promise<VerifyPinningResult> {
  const record = await runs.get(runId)
  if (!record) {
    throw new Error(`verifyPinning: no run with id "${runId}"`)
  }
  return verifyPinningAgainst(record, currentModelMapping, currentPromptHashes)
}

export function verifyPinningAgainst(
  record: RunRecord,
  currentModelMapping: ModelMapping,
  currentPromptHashes: PromptHashes,
): VerifyPinningResult {
  const mismatches: PinningMismatch[] = []

  for (const role of Object.keys(currentModelMapping) as Array<keyof ModelMapping>) {
    const expected = record.modelMapping[role]
    const actual = currentModelMapping[role]
    if (expected !== actual) {
      mismatches.push({
        path: `modelMapping.${role}`,
        expected: String(expected),
        actual: String(actual),
      })
    }
  }
  for (const role of Object.keys(record.modelMapping) as Array<keyof ModelMapping>) {
    if (!(role in currentModelMapping)) {
      mismatches.push({
        path: `modelMapping.${role}`,
        expected: String(record.modelMapping[role]),
        actual: '<missing>',
      })
    }
  }

  for (const name of Object.keys(currentPromptHashes)) {
    const expected = record.promptHashes[name]
    const actual = currentPromptHashes[name]
    if (expected === undefined) {
      mismatches.push({
        path: `promptHashes.${name}`,
        expected: '<missing>',
        actual,
      })
      continue
    }
    if (expected !== actual) {
      mismatches.push({
        path: `promptHashes.${name}`,
        expected,
        actual,
      })
    }
  }
  for (const name of Object.keys(record.promptHashes)) {
    if (!(name in currentPromptHashes)) {
      mismatches.push({
        path: `promptHashes.${name}`,
        expected: record.promptHashes[name],
        actual: '<missing>',
      })
    }
  }

  return { ok: mismatches.length === 0, mismatches }
}

export async function hashPromptBody(body: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) {
    throw new Error('hashPromptBody: SubtleCrypto unavailable')
  }
  const encoder = new TextEncoder()
  const data = encoder.encode(body)
  const buf = await subtle.digest('SHA-256', data)
  return bufferToHex(buf)
}

function bufferToHex(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let out = ''
  for (let i = 0; i < bytes.length; i += 1) {
    out += bytes[i].toString(16).padStart(2, '0')
  }
  return out
}

export type PinningSnapshot = {
  modelMapping: ModelMapping
  promptHashes: PromptHashes
}

export async function buildPromptHashes(
  prompts: ReadonlyArray<{ name: string; body: string }>,
): Promise<PromptHashes> {
  const entries = await Promise.all(
    prompts.map(async (p) => [p.name, await hashPromptBody(p.body)] as const),
  )
  return entries.reduce<PromptHashes>((acc, [name, hash]) => {
    return { ...acc, [name]: hash }
  }, {})
}

export function listPhaseNames(): ReadonlyArray<PhaseName> {
  return PHASE_NAMES
}
