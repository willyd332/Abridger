import 'fake-indexeddb/auto'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { deleteDB } from 'idb'

import {
  brackets,
  books,
  events,
  outputs,
  runs,
  sections,
  spine,
} from '@/state/persistence'
import { DB_NAME, closeDb, getDb, resetDbForTests } from '@/state/db'
import { defaultSectionPhaseStatus } from '@/state/types'
import {
  reapOrphans,
  verifyPinningAgainst,
  buildPromptHashes,
  hashPromptBody,
  findResumableRun,
  ORPHAN_THRESHOLD_MS,
} from '@/state/resume'

import {
  makeBookRecord,
  makeBracketRecord,
  makeEventRecord,
  makeOutputRecord,
  makeRunRecord,
  makeSectionRecord,
  makeSpineRecord,
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

describe('schema upgrade', () => {
  it('invokes the upgrade callback on first open', async () => {
    const db = await getDb()
    const storeNames = Array.from(db.objectStoreNames).sort()
    expect(storeNames).toEqual(
      [
        'books',
        'brackets',
        'dependencies',
        'events',
        'inclusion',
        'ontology',
        'outputs',
        'runs',
        'sections',
        'spine',
      ].sort(),
    )
  })
})

describe('runs CRUD', () => {
  it('creates and gets a run', async () => {
    const created = await runs.create(makeRunRecord({ runId: 'r1' }))
    expect(created.runId).toBe('r1')
    const fetched = await runs.get('r1')
    expect(fetched).not.toBeNull()
    expect(fetched?.runId).toBe('r1')
  })

  it('lists runs filtered by status via the by-status index', async () => {
    await runs.create(makeRunRecord({ runId: 'r1', status: 'in_progress' }))
    await runs.create(makeRunRecord({ runId: 'r2', status: 'done' }))
    await runs.create(makeRunRecord({ runId: 'r3', status: 'in_progress' }))
    const inProgress = await runs.list({ status: 'in_progress' })
    expect(inProgress.map((r) => r.runId).sort()).toEqual(['r1', 'r3'])
  })

  it('update is immutable: merges patch into new record without mutating original', async () => {
    const original = await runs.create(makeRunRecord({ runId: 'r1', phase: 'A' }))
    const updated = await runs.update('r1', { phase: 'B' })
    expect(updated.phase).toBe('B')
    expect(original.phase).toBe('A')
    expect(updated.runId).toBe(original.runId)
    expect(updated.createdAt).toBe(original.createdAt)
  })

  it('delete removes a run', async () => {
    await runs.create(makeRunRecord({ runId: 'r1' }))
    await runs.delete('r1')
    expect(await runs.get('r1')).toBeNull()
  })

  it('update throws when run is missing', async () => {
    await expect(runs.update('nope', { phase: 'X' })).rejects.toThrow(/no run/)
  })
})

describe('books CRUD', () => {
  it('round-trips a book record with a Blob payload', async () => {
    const blob = new Blob(['hello'], { type: 'application/pdf' })
    const record = makeBookRecord({ bookId: 'b1', runId: 'r1', blob })
    await books.create(record)
    const fetched = await books.get('b1')
    expect(fetched?.bookId).toBe('b1')
    expect(fetched?.originalBlob).toBeDefined()
    // fake-indexeddb's structured clone may convert Blob to a Blob-like with
    // varying surface depending on jsdom version; we assert presence + identity-of-fields.
    expect(fetched?.originalFileSize).toBe(blob.size)
  })

  it('getByRun finds the book via the by-run index', async () => {
    await books.create(makeBookRecord({ bookId: 'b1', runId: 'r1' }))
    const fetched = await books.getByRun('r1')
    expect(fetched?.bookId).toBe('b1')
  })
})

describe('sections CRUD with compound key', () => {
  it('stores and retrieves by compound key [runId, sectionId]', async () => {
    const record = makeSectionRecord({ runId: 'r1', sectionId: 's1', order: 1 })
    await sections.create(record)
    const fetched = await sections.get('r1', 's1')
    expect(fetched?.sectionId).toBe('s1')
  })

  it('same sectionId in different runs are independent', async () => {
    await sections.create(makeSectionRecord({ runId: 'r1', sectionId: 's1', order: 1 }))
    await sections.create(makeSectionRecord({ runId: 'r2', sectionId: 's1', order: 1 }))
    const a = await sections.get('r1', 's1')
    const b = await sections.get('r2', 's1')
    expect(a?.runId).toBe('r1')
    expect(b?.runId).toBe('r2')
  })

  it('listByRun returns sections sorted by order', async () => {
    await sections.create(makeSectionRecord({ runId: 'r1', sectionId: 's3', order: 3 }))
    await sections.create(makeSectionRecord({ runId: 'r1', sectionId: 's1', order: 1 }))
    await sections.create(makeSectionRecord({ runId: 'r1', sectionId: 's2', order: 2 }))
    const list = await sections.listByRun('r1')
    expect(list.map((s) => s.sectionId)).toEqual(['s1', 's2', 's3'])
  })

  it('update merges phaseStatus immutably', async () => {
    const phaseStatus = defaultSectionPhaseStatus()
    await sections.create(
      makeSectionRecord({ runId: 'r1', sectionId: 's1', order: 1, phaseStatus }),
    )
    const next = {
      ...phaseStatus,
      A: { ...phaseStatus.A, status: 'done' as const, attempts: 1 },
    }
    const updated = await sections.update('r1', 's1', { phaseStatus: next })
    expect(updated.phaseStatus.A.status).toBe('done')
    expect(phaseStatus.A.status).toBe('pending')
  })

  it('deleteByRun removes all sections for a run', async () => {
    await sections.create(makeSectionRecord({ runId: 'r1', sectionId: 's1', order: 1 }))
    await sections.create(makeSectionRecord({ runId: 'r1', sectionId: 's2', order: 2 }))
    await sections.create(makeSectionRecord({ runId: 'r2', sectionId: 's1', order: 1 }))
    const count = await sections.deleteByRun('r1')
    expect(count).toBe(2)
    expect(await sections.listByRun('r1')).toEqual([])
    expect(await sections.listByRun('r2')).toHaveLength(1)
  })
})

describe('spine CRUD', () => {
  it('round-trips a spine record', async () => {
    await spine.create(makeSpineRecord({ runId: 'r1' }))
    const fetched = await spine.get('r1')
    expect(fetched?.runId).toBe('r1')
    expect(fetched?.spine.centralArgument).toContain('Argument')
  })
})

describe('brackets CRUD with compound key', () => {
  it('compound key [runId, sectionId, deletionIndex] keeps entries distinct', async () => {
    await brackets.create(
      makeBracketRecord({ runId: 'r1', sectionId: 's1', deletionIndex: -1, bracketText: 'whole' }),
    )
    await brackets.create(
      makeBracketRecord({ runId: 'r1', sectionId: 's1', deletionIndex: 0, bracketText: 'cut0' }),
    )
    await brackets.create(
      makeBracketRecord({ runId: 'r1', sectionId: 's1', deletionIndex: 1, bracketText: 'cut1' }),
    )
    const list = await brackets.listBySection('r1', 's1')
    expect(list.map((b) => b.deletionIndex)).toEqual([-1, 0, 1])
    expect(list.map((b) => b.bracketText)).toEqual(['whole', 'cut0', 'cut1'])
  })
})

describe('outputs CRUD', () => {
  it('compound key [runId, kind] supports multiple kinds per run', async () => {
    const blobA = new Blob(['pdf'], { type: 'application/pdf' })
    const blobB = new Blob(['epub'], { type: 'application/epub+zip' })
    await outputs.create(
      makeOutputRecord({ runId: 'r1', kind: 'abridged-pdf', blob: blobA }),
    )
    await outputs.create(
      makeOutputRecord({ runId: 'r1', kind: 'abridged-epub', blob: blobB }),
    )
    const list = await outputs.listByRun('r1')
    expect(list.map((o) => o.kind).sort()).toEqual(['abridged-epub', 'abridged-pdf'])
  })
})

describe('events log', () => {
  it('append + listByRun returns events in insertion order', async () => {
    await events.append(makeEventRecord({ runId: 'r1', timestamp: 100, phase: 'A' }))
    await events.append(makeEventRecord({ runId: 'r1', timestamp: 200, phase: 'B' }))
    await events.append(makeEventRecord({ runId: 'r2', timestamp: 150, phase: 'A' }))
    const log = await events.listByRun('r1')
    expect(log).toHaveLength(2)
    expect(log.map((e) => e.timestamp)).toEqual([100, 200])
  })

  it('since returns only events after a timestamp', async () => {
    await events.append(makeEventRecord({ runId: 'r1', timestamp: 100, phase: 'A' }))
    await events.append(makeEventRecord({ runId: 'r1', timestamp: 200, phase: 'B' }))
    await events.append(makeEventRecord({ runId: 'r1', timestamp: 300, phase: 'C' }))
    const recent = await events.since('r1', 150)
    expect(recent.map((e) => e.timestamp)).toEqual([200, 300])
  })
})

describe('reapOrphans', () => {
  it('resets in_flight rows older than threshold back to pending', async () => {
    const phaseStatus = defaultSectionPhaseStatus()
    const now = 10_000_000
    const staleStart = now - ORPHAN_THRESHOLD_MS - 1
    const freshStart = now - 1_000
    const withStale = {
      ...phaseStatus,
      A: {
        status: 'in_flight' as const,
        attempts: 1,
        requestStartedAt: staleStart,
        requestId: 'req-stale',
      },
      B: {
        status: 'in_flight' as const,
        attempts: 1,
        requestStartedAt: freshStart,
        requestId: 'req-fresh',
      },
    }
    await sections.create(
      makeSectionRecord({
        runId: 'r1',
        sectionId: 's1',
        order: 1,
        phaseStatus: withStale,
      }),
    )

    const result = await reapOrphans('r1', { now })
    expect(result.reaped).toBe(1)
    expect(result.reapedSectionIds).toEqual(['s1'])

    const after = await sections.get('r1', 's1')
    expect(after?.phaseStatus.A.status).toBe('pending')
    expect(after?.phaseStatus.A.lastError).toBe('orphan-reaped')
    expect(after?.phaseStatus.B.status).toBe('in_flight')
  })

  it('returns zero when no rows are stale', async () => {
    const phaseStatus = defaultSectionPhaseStatus()
    await sections.create(makeSectionRecord({ runId: 'r1', sectionId: 's1', order: 1, phaseStatus }))
    const result = await reapOrphans('r1', { now: Date.now() })
    expect(result.reaped).toBe(0)
  })
})

describe('verifyPinning', () => {
  it('reports no mismatches when model mapping and prompt hashes agree', async () => {
    const promptHashes = await buildPromptHashes([
      { name: 'summarize', body: 'You are a summarizer.' },
      { name: 'macro-filter', body: 'You are the macro filter.' },
    ])
    const record = await runs.create(
      makeRunRecord({
        runId: 'r1',
        modelMapping: {
          cheap: 'claude-haiku-4-5-20251001',
          smart: 'claude-sonnet-4-6',
          reasoning: 'claude-opus-4-7',
        },
        promptHashes,
      }),
    )
    const result = verifyPinningAgainst(record, record.modelMapping, record.promptHashes)
    expect(result.ok).toBe(true)
    expect(result.mismatches).toEqual([])
  })

  it('reports mismatches by name when prompt body or model has changed', async () => {
    const promptHashes = await buildPromptHashes([
      { name: 'summarize', body: 'Old summarize body.' },
      { name: 'macro-filter', body: 'Old macro filter body.' },
    ])
    await runs.create(
      makeRunRecord({
        runId: 'r1',
        modelMapping: {
          cheap: 'claude-haiku-4-5-20251001',
          smart: 'claude-sonnet-4-6',
          reasoning: 'claude-opus-4-7',
        },
        promptHashes,
      }),
    )
    const currentMapping = {
      cheap: 'claude-haiku-4-5-20251001',
      smart: 'claude-sonnet-4-7', // changed
      reasoning: 'claude-opus-4-7',
    }
    const currentHashes = await buildPromptHashes([
      { name: 'summarize', body: 'NEW summarize body.' }, // changed
      { name: 'macro-filter', body: 'Old macro filter body.' },
      { name: 'bracket-writer', body: 'New prompt added.' }, // new
    ])
    const fetched = await runs.get('r1')
    if (!fetched) throw new Error('expected run')
    const result = verifyPinningAgainst(fetched, currentMapping, currentHashes)
    expect(result.ok).toBe(false)
    const paths = result.mismatches.map((m) => m.path).sort()
    expect(paths).toContain('modelMapping.smart')
    expect(paths).toContain('promptHashes.summarize')
    expect(paths).toContain('promptHashes.bracket-writer')
  })

  it('hashPromptBody is deterministic and 64-hex-char SHA-256', async () => {
    const a = await hashPromptBody('hello')
    const b = await hashPromptBody('hello')
    const c = await hashPromptBody('different')
    expect(a).toBe(b)
    expect(a).not.toBe(c)
    expect(/^[0-9a-f]{64}$/.test(a)).toBe(true)
  })
})

describe('findResumableRun', () => {
  it('returns the most recently updated in_progress or paused run', async () => {
    await runs.create(makeRunRecord({ runId: 'old', status: 'in_progress' }))
    await new Promise((resolve) => setTimeout(resolve, 5))
    await runs.create(makeRunRecord({ runId: 'newer', status: 'paused' }))
    await new Promise((resolve) => setTimeout(resolve, 5))
    await runs.create(makeRunRecord({ runId: 'done', status: 'done' }))

    const match = await findResumableRun()
    expect(match).not.toBeNull()
    expect(['old', 'newer']).toContain(match?.runId)
    // most-recent semantics: 'newer' should win (it was created last)
    expect(match?.runId).toBe('newer')
  })

  it('returns null when no resumable runs exist', async () => {
    await runs.create(makeRunRecord({ runId: 'r1', status: 'done' }))
    const match = await findResumableRun()
    expect(match).toBeNull()
  })
})
