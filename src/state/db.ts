import { openDB, type DBSchema, type IDBPDatabase } from 'idb'

import type {
  BookRecord,
  BracketRecord,
  EventRecord,
  OutputRecord,
  RunRecord,
  SectionRecord,
  SpineRecord,
} from './types'

/*
 * MIGRATIONS.md
 *
 * Database name: `abridger`
 * Current version: 1
 *
 * Future schema versions MUST preserve the primary keying scheme:
 *   runs:     keyed by `runId`
 *   books:    keyed by `bookId`
 *   sections: compound key `[runId, sectionId]`
 *   spine:    keyed by `runId`
 *   brackets: compound key `[runId, sectionId, deletionIndex]`
 *   outputs:  compound key `[runId, kind]`
 *   events:   auto-increment id; indexed by `[runId, timestamp]`
 *
 * If a future version renames a store, the upgrade callback MUST migrate
 * existing rows. Never drop data in an upgrade — runs may be multi-day jobs
 * mid-flight when the user reloads after we ship a new version.
 */

export const DB_NAME = 'abridger'
export const DB_VERSION = 1

export interface AbridgerSchema extends DBSchema {
  runs: {
    key: string
    value: RunRecord
    indexes: { 'by-status': string }
  }
  books: {
    key: string
    value: BookRecord
    indexes: { 'by-run': string }
  }
  sections: {
    key: [string, string]
    value: SectionRecord
    indexes: { 'by-run': string }
  }
  spine: {
    key: string
    value: SpineRecord
  }
  brackets: {
    key: [string, string, number]
    value: BracketRecord
    indexes: { 'by-run-section': [string, string] }
  }
  outputs: {
    key: [string, string]
    value: OutputRecord
    indexes: { 'by-run': string }
  }
  events: {
    key: number
    value: EventRecord
    indexes: { 'by-run-timestamp': [string, number] }
  }
}

export type AbridgerDb = IDBPDatabase<AbridgerSchema>

let dbPromise: Promise<AbridgerDb> | null = null

export function getDb(): Promise<AbridgerDb> {
  if (!dbPromise) {
    dbPromise = openDB<AbridgerSchema>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          createInitialStores(db)
        }
      },
      blocked() {
        // Another tab holds an older version of the IndexedDB schema and
        // refuses to release its connection. We intentionally do not log
        // here — the upgrade path will retry once the other tab closes,
        // and the UI surfaces resumability state via `findResumableRun()`.
      },
      blocking() {
        // We are blocking a newer version. Closing lets the new version proceed.
        // Note: callers may have outstanding transactions; close defers until idle.
        try {
          dbPromise = null
        } catch {
          // best-effort
        }
      },
      terminated() {
        dbPromise = null
      },
    })
  }
  return dbPromise
}

export async function closeDb(): Promise<void> {
  if (dbPromise) {
    const db = await dbPromise
    db.close()
    dbPromise = null
  }
}

export function resetDbForTests(): void {
  dbPromise = null
}

function createInitialStores(db: AbridgerDb): void {
  const runs = db.createObjectStore('runs', { keyPath: 'runId' })
  runs.createIndex('by-status', 'status', { unique: false })

  const books = db.createObjectStore('books', { keyPath: 'bookId' })
  books.createIndex('by-run', 'runId', { unique: false })

  const sections = db.createObjectStore('sections', {
    keyPath: ['runId', 'sectionId'],
  })
  sections.createIndex('by-run', 'runId', { unique: false })

  db.createObjectStore('spine', { keyPath: 'runId' })

  const brackets = db.createObjectStore('brackets', {
    keyPath: ['runId', 'sectionId', 'deletionIndex'],
  })
  brackets.createIndex('by-run-section', ['runId', 'sectionId'], {
    unique: false,
  })

  const outputs = db.createObjectStore('outputs', { keyPath: ['runId', 'kind'] })
  outputs.createIndex('by-run', 'runId', { unique: false })

  const events = db.createObjectStore('events', {
    keyPath: 'id',
    autoIncrement: true,
  })
  events.createIndex('by-run-timestamp', ['runId', 'timestamp'], {
    unique: false,
  })
}
