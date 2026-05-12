import 'fake-indexeddb/auto'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { deleteDB } from 'idb'

import { LLMClient } from '@/llm/client'
import type { ParsedBook } from '@/parsers/types'

import { detectRoute, executeShortBookRoute } from '@/pipeline/routes'
import type { RouteContext } from '@/pipeline/routes'

import { DB_NAME, closeDb, resetDbForTests } from '@/state/db'
import { books, brackets, outputs, runs as runsStore } from '@/state/persistence'

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

function makeShortBook(): ParsedBook {
  const pages = Array.from({ length: 50 }, (_, i) => ({
    number: i + 1,
    blocks: [
      {
        id: `${i + 1}-0`,
        text: `Page ${i + 1} body content with some prose and an argument going on here.`,
        classification: 'body' as const,
        pageNumber: i + 1,
      },
    ],
  }))
  return {
    id: 'short-book-test',
    format: 'pdf',
    title: 'A Short Book',
    author: 'Some Author',
    pages,
    rawText: pages
      .map((p) => p.blocks.map((b) => b.text).join('\n'))
      .join('\n')
      .trim(),
    matter: { detected: [] },
    warnings: [],
  }
}

function makeTestClient(): LLMClient {
  const client = new LLMClient({
    provider: 'anthropic',
    apiKey: 'sk-ant-test',
    ceilingUsd: 100,
  })
  const mock = client.useMockProvider()
  mock.setDefaultResponse({
    text: JSON.stringify({
      abridged: 'Abridged book content here, condensed to roughly forty percent of the original.',
      ledger: [
        {
          cutLocation: 'pages 10–14, digression about side topic',
          replacementBracket: 'The author then briefly digresses on a side topic.',
          rationale: 'This digression does not contribute to the central argument.',
        },
      ],
    }),
    promptTokens: 1000,
    completionTokens: 500,
  })
  return client
}

async function seedRunRecord(runId: string, book: ParsedBook): Promise<void> {
  await runsStore.create({
    runId,
    bookId: 'book-1',
    status: 'in_progress',
    phase: 'INTAKE',
    route: 'short-book',
    purpose: 'test',
    provider: 'anthropic',
    modelMapping: {
      cheap: 'claude-haiku-4-5-20251001',
      smart: 'claude-sonnet-4-6',
      reasoning: 'claude-opus-4-7',
    },
    promptHashes: {},
    cost: { ceilingUsd: 100, reservedUsd: 0, billedUsd: 0 },
    storeKeyLocally: false,
    frontBackMatterHandling: 'abridge',
  })
  await books.create({
    bookId: 'book-1',
    runId,
    format: 'pdf',
    originalFileName: 'short.pdf',
    originalFileSize: 100,
    parsed: book,
    originalBlob: new Blob(['stub'], { type: 'application/pdf' }),
  })
}

describe('detectRoute (short-book)', () => {
  it('selects short-book for under 100 pages and small token budget', () => {
    const book = makeShortBook()
    const detection = detectRoute(book)
    expect(detection.route).toBe('short-book')
  })

  it('selects normal-book for a mid-size book', () => {
    const pages = Array.from({ length: 250 }, (_, i) => ({
      number: i + 1,
      blocks: [
        {
          id: `${i + 1}-0`,
          text: `Page ${i + 1} of medium-length book with prose content here taking up real space.`,
          classification: 'body' as const,
          pageNumber: i + 1,
        },
      ],
    }))
    const book: ParsedBook = {
      id: 'normal-book',
      format: 'pdf',
      pages,
      rawText: pages.map((p) => p.blocks[0].text).join('\n'),
      matter: { detected: [] },
      warnings: [],
    }
    const detection = detectRoute(book)
    expect(detection.route).toBe('normal-book')
  })
})

describe('executeShortBookRoute', () => {
  it('runs the single-call path and produces an abridged blob + ledger', async () => {
    const book = makeShortBook()
    const runId = 'short-run-1'
    await seedRunRecord(runId, book)
    const client = makeTestClient()
    const ctx: RouteContext = {
      runId,
      book,
      originalBlob: new Blob(['stub'], { type: 'application/pdf' }),
      purpose: 'test purpose',
      client,
    }
    const result = await executeShortBookRoute(ctx, {
      modelMapping: {
        cheap: 'claude-haiku-4-5-20251001',
        smart: 'claude-sonnet-4-6',
        reasoning: 'claude-opus-4-7',
      },
      promptHashes: {},
      originalFileName: 'short.pdf',
      startedAt: Date.now(),
    })

    expect(result.abridgedBlob).toBeInstanceOf(Blob)
    expect(result.ledgerBlob).toBeInstanceOf(Blob)
    expect(result.abridgedBlob.size).toBeGreaterThan(0)
    expect(result.ledgerBlob.size).toBeGreaterThan(0)

    const outs = await outputs.listByRun(runId)
    expect(outs.length).toBe(2)
    const brackList = await brackets.listByRun(runId)
    expect(brackList.length).toBeGreaterThanOrEqual(1)
  })
})
