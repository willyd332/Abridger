import { getDb } from './db'
import type {
  BookRecord,
  BracketRecord,
  DependenciesRecord,
  EventRecord,
  InclusionRecord,
  NewRun,
  OntologyRecord,
  OutputRecord,
  RunRecord,
  RunStatus,
  SectionRecord,
  SpineRecord,
} from './types'

// All updates are immutable: read current record, spread, merge, write the new record.

function now(): number {
  return Date.now()
}

export const runs = {
  async create(record: NewRun): Promise<RunRecord> {
    const db = await getDb()
    const ts = now()
    const newRecord: RunRecord = {
      ...record,
      createdAt: record.createdAt ?? ts,
      updatedAt: record.updatedAt ?? ts,
    }
    await db.put('runs', newRecord)
    return newRecord
  },

  async get(runId: string): Promise<RunRecord | null> {
    const db = await getDb()
    const record = await db.get('runs', runId)
    return record ?? null
  },

  async list(filter?: { status?: RunStatus }): Promise<RunRecord[]> {
    const db = await getDb()
    if (filter?.status) {
      return db.getAllFromIndex('runs', 'by-status', filter.status)
    }
    return db.getAll('runs')
  },

  async update(runId: string, patch: Partial<RunRecord>): Promise<RunRecord> {
    const db = await getDb()
    const tx = db.transaction('runs', 'readwrite')
    const current = await tx.store.get(runId)
    if (!current) {
      throw new Error(`runs.update: no run with id "${runId}"`)
    }
    const merged: RunRecord = {
      ...current,
      ...patch,
      runId: current.runId,
      createdAt: current.createdAt,
      updatedAt: now(),
    }
    await tx.store.put(merged)
    await tx.done
    return merged
  },

  async delete(runId: string): Promise<void> {
    const db = await getDb()
    await db.delete('runs', runId)
  },
}

export const books = {
  async create(record: BookRecord): Promise<BookRecord> {
    const db = await getDb()
    await db.put('books', record)
    return record
  },

  async get(bookId: string): Promise<BookRecord | null> {
    const db = await getDb()
    const record = await db.get('books', bookId)
    return record ?? null
  },

  async getByRun(runId: string): Promise<BookRecord | null> {
    const db = await getDb()
    const results = await db.getAllFromIndex('books', 'by-run', runId)
    return results[0] ?? null
  },

  async update(bookId: string, patch: Partial<BookRecord>): Promise<BookRecord> {
    const db = await getDb()
    const tx = db.transaction('books', 'readwrite')
    const current = await tx.store.get(bookId)
    if (!current) {
      throw new Error(`books.update: no book with id "${bookId}"`)
    }
    const merged: BookRecord = {
      ...current,
      ...patch,
      bookId: current.bookId,
    }
    await tx.store.put(merged)
    await tx.done
    return merged
  },

  async delete(bookId: string): Promise<void> {
    const db = await getDb()
    await db.delete('books', bookId)
  },
}

export const sections = {
  async create(record: SectionRecord): Promise<SectionRecord> {
    const db = await getDb()
    await db.put('sections', record)
    return record
  },

  async get(runId: string, sectionId: string): Promise<SectionRecord | null> {
    const db = await getDb()
    const record = await db.get('sections', [runId, sectionId])
    return record ?? null
  },

  async listByRun(runId: string): Promise<SectionRecord[]> {
    const db = await getDb()
    const all = await db.getAllFromIndex('sections', 'by-run', runId)
    return [...all].sort((a, b) => a.order - b.order)
  },

  async update(
    runId: string,
    sectionId: string,
    patch: Partial<SectionRecord>,
  ): Promise<SectionRecord> {
    const db = await getDb()
    const tx = db.transaction('sections', 'readwrite')
    const current = await tx.store.get([runId, sectionId])
    if (!current) {
      throw new Error(`sections.update: no section with id "${sectionId}" for run "${runId}"`)
    }
    const merged: SectionRecord = {
      ...current,
      ...patch,
      runId: current.runId,
      sectionId: current.sectionId,
    }
    await tx.store.put(merged)
    await tx.done
    return merged
  },

  async delete(runId: string, sectionId: string): Promise<void> {
    const db = await getDb()
    await db.delete('sections', [runId, sectionId])
  },

  async deleteByRun(runId: string): Promise<number> {
    const db = await getDb()
    const tx = db.transaction('sections', 'readwrite')
    const index = tx.store.index('by-run')
    let cursor = await index.openCursor(runId)
    let count = 0
    while (cursor) {
      await cursor.delete()
      count += 1
      cursor = await cursor.continue()
    }
    await tx.done
    return count
  },
}

export const spine = {
  async create(record: SpineRecord): Promise<SpineRecord> {
    const db = await getDb()
    await db.put('spine', record)
    return record
  },

  async get(runId: string): Promise<SpineRecord | null> {
    const db = await getDb()
    const record = await db.get('spine', runId)
    return record ?? null
  },

  async update(runId: string, patch: Partial<SpineRecord>): Promise<SpineRecord> {
    const db = await getDb()
    const tx = db.transaction('spine', 'readwrite')
    const current = await tx.store.get(runId)
    if (!current) {
      throw new Error(`spine.update: no spine for run "${runId}"`)
    }
    const merged: SpineRecord = {
      ...current,
      ...patch,
      runId: current.runId,
    }
    await tx.store.put(merged)
    await tx.done
    return merged
  },

  async delete(runId: string): Promise<void> {
    const db = await getDb()
    await db.delete('spine', runId)
  },
}

export const brackets = {
  async create(record: BracketRecord): Promise<BracketRecord> {
    const db = await getDb()
    await db.put('brackets', record)
    return record
  },

  async get(
    runId: string,
    sectionId: string,
    deletionIndex: number,
  ): Promise<BracketRecord | null> {
    const db = await getDb()
    const record = await db.get('brackets', [runId, sectionId, deletionIndex])
    return record ?? null
  },

  async listBySection(runId: string, sectionId: string): Promise<BracketRecord[]> {
    const db = await getDb()
    const all = await db.getAllFromIndex('brackets', 'by-run-section', [runId, sectionId])
    return [...all].sort((a, b) => a.deletionIndex - b.deletionIndex)
  },

  async listByRun(runId: string): Promise<BracketRecord[]> {
    const db = await getDb()
    const all = await db.getAll('brackets')
    return all.filter((r) => r.runId === runId)
  },

  async delete(runId: string, sectionId: string, deletionIndex: number): Promise<void> {
    const db = await getDb()
    await db.delete('brackets', [runId, sectionId, deletionIndex])
  },
}

export const outputs = {
  async create(record: OutputRecord): Promise<OutputRecord> {
    const db = await getDb()
    await db.put('outputs', record)
    return record
  },

  async get(runId: string, kind: OutputRecord['kind']): Promise<OutputRecord | null> {
    const db = await getDb()
    const record = await db.get('outputs', [runId, kind])
    return record ?? null
  },

  async listByRun(runId: string): Promise<OutputRecord[]> {
    const db = await getDb()
    return db.getAllFromIndex('outputs', 'by-run', runId)
  },

  async delete(runId: string, kind: OutputRecord['kind']): Promise<void> {
    const db = await getDb()
    await db.delete('outputs', [runId, kind])
  },
}

export const ontology = {
  async put(record: OntologyRecord): Promise<OntologyRecord> {
    const db = await getDb()
    await db.put('ontology', record)
    return record
  },

  async get(runId: string): Promise<OntologyRecord | null> {
    const db = await getDb()
    const record = await db.get('ontology', runId)
    return record ?? null
  },

  async delete(runId: string): Promise<void> {
    const db = await getDb()
    await db.delete('ontology', runId)
  },
}

export const inclusion = {
  async put(record: InclusionRecord): Promise<InclusionRecord> {
    const db = await getDb()
    await db.put('inclusion', record)
    return record
  },

  async get(runId: string): Promise<InclusionRecord | null> {
    const db = await getDb()
    const record = await db.get('inclusion', runId)
    return record ?? null
  },

  async update(
    runId: string,
    mutate: (current: Record<string, boolean>) => Record<string, boolean>,
  ): Promise<InclusionRecord> {
    const db = await getDb()
    const tx = db.transaction('inclusion', 'readwrite')
    const current = (await tx.store.get(runId)) ?? {
      runId,
      inclusion: {},
      updatedAt: 0,
    }
    const next: InclusionRecord = {
      runId,
      inclusion: mutate(current.inclusion),
      updatedAt: now(),
    }
    await tx.store.put(next)
    await tx.done
    return next
  },

  async delete(runId: string): Promise<void> {
    const db = await getDb()
    await db.delete('inclusion', runId)
  },
}

export const dependencies = {
  async put(record: DependenciesRecord): Promise<DependenciesRecord> {
    const db = await getDb()
    await db.put('dependencies', record)
    return record
  },

  async get(runId: string, nodeId: string): Promise<DependenciesRecord | null> {
    const db = await getDb()
    const record = await db.get('dependencies', [runId, nodeId])
    return record ?? null
  },

  async listByRun(runId: string): Promise<DependenciesRecord[]> {
    const db = await getDb()
    return db.getAllFromIndex('dependencies', 'by-run', runId)
  },

  async deleteByRun(runId: string): Promise<number> {
    const db = await getDb()
    const tx = db.transaction('dependencies', 'readwrite')
    const index = tx.store.index('by-run')
    let cursor = await index.openCursor(runId)
    let count = 0
    while (cursor) {
      await cursor.delete()
      count += 1
      cursor = await cursor.continue()
    }
    await tx.done
    return count
  },
}

export const events = {
  async append(event: Omit<EventRecord, 'id'>): Promise<number> {
    const db = await getDb()
    const key = await db.add('events', event as EventRecord)
    return Number(key)
  },

  async listByRun(runId: string): Promise<EventRecord[]> {
    const db = await getDb()
    const lower: [string, number] = [runId, -Infinity]
    const upper: [string, number] = [runId, Infinity]
    const range = IDBKeyRange.bound(lower, upper)
    return db.getAllFromIndex('events', 'by-run-timestamp', range)
  },

  async since(runId: string, timestamp: number): Promise<EventRecord[]> {
    const db = await getDb()
    const lower: [string, number] = [runId, timestamp]
    const upper: [string, number] = [runId, Infinity]
    const range = IDBKeyRange.bound(lower, upper, true, false)
    return db.getAllFromIndex('events', 'by-run-timestamp', range)
  },

  async deleteByRun(runId: string): Promise<number> {
    const db = await getDb()
    const tx = db.transaction('events', 'readwrite')
    const index = tx.store.index('by-run-timestamp')
    const lower: [string, number] = [runId, -Infinity]
    const upper: [string, number] = [runId, Infinity]
    const range = IDBKeyRange.bound(lower, upper)
    let cursor = await index.openCursor(range)
    let count = 0
    while (cursor) {
      await cursor.delete()
      count += 1
      cursor = await cursor.continue()
    }
    await tx.done
    return count
  },
}
