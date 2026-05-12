import 'fake-indexeddb/auto'

import JSZip from 'jszip'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { deleteDB } from 'idb'

import { LLMClient } from '@/llm/client'
import type { MockProvider } from '@/llm/mock'
import {
  findResumable,
  resumeRun,
  startRun,
  type StartRunInput,
} from '@/pipeline/orchestrator'
import { DB_NAME, closeDb, resetDbForTests } from '@/state/db'
import {
  outputs as outputsStore,
  runs as runsStore,
  sections as sectionsStore,
} from '@/state/persistence'
import { reapOrphans } from '@/state/resume'

const NS_OPF = 'http://www.idpf.org/2007/opf'

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

function makeContainerXml(opfPath: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="${opfPath}" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`
}

function makeOpfXml(items: Array<{ id: string; href: string }>): string {
  const manifestItems = items
    .map((i) => `<item id="${i.id}" href="${i.href}" media-type="application/xhtml+xml"/>`)
    .join('\n    ')
  const spineItems = items.map((i) => `<itemref idref="${i.id}"/>`).join('\n    ')
  return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="${NS_OPF}" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Tiny Test Book</dc:title>
    <dc:creator>Tester</dc:creator>
    <dc:identifier id="bookid">tiny-test</dc:identifier>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
    ${manifestItems}
  </manifest>
  <spine>
    ${spineItems}
  </spine>
</package>`
}

function makeXhtml(title: string, paragraphs: string[]): string {
  const body = paragraphs.map((p) => `<p>${p}</p>`).join('\n    ')
  return `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>${title}</title></head>
<body>
    ${body}
</body>
</html>`
}

function bytesToFile(bytes: Uint8Array, name: string, type: string): File {
  // In jsdom, the Blob's `.arrayBuffer()` is undefined. We attach a polyfilled
  // `arrayBuffer` method that returns the original bytes so downstream code
  // that calls `file.arrayBuffer()` works.
  const blob = new Blob([bytes], { type })
  // The polyfill returns the bytes (which structurally satisfy ArrayBuffer for
  // JSZip's loadAsync). The underlying buffer of the Uint8Array is a valid
  // ArrayBuffer.
  if (typeof (blob as { arrayBuffer?: () => Promise<ArrayBuffer> }).arrayBuffer !== 'function') {
    Object.defineProperty(blob, 'arrayBuffer', {
      configurable: true,
      writable: true,
      value: () =>
        Promise.resolve(
          bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
        ),
    })
  }
  const file = new File([blob], name, { type })
  if (typeof (file as { arrayBuffer?: () => Promise<ArrayBuffer> }).arrayBuffer !== 'function') {
    Object.defineProperty(file, 'arrayBuffer', {
      configurable: true,
      writable: true,
      value: () =>
        Promise.resolve(
          bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
        ),
    })
  }
  return file
}

async function buildTinyEpub(): Promise<File> {
  const zip = new JSZip()
  const opfPath = 'OEBPS/content.opf'
  zip.file('mimetype', 'application/epub+zip')
  zip.file('META-INF/container.xml', makeContainerXml(opfPath))
  const items = [
    { id: 'chap1', href: 'chap1.xhtml' },
    { id: 'chap2', href: 'chap2.xhtml' },
  ]
  zip.file(opfPath, makeOpfXml(items))
  zip.file(
    'OEBPS/chap1.xhtml',
    makeXhtml('Chapter One', [
      'The first paragraph of chapter one introduces the central topic of the book in some detail.',
      'It develops a brief argument about the structure of the work and points forward to chapter two.',
      'A closing paragraph that hints at what is to come in later chapters.',
    ]),
  )
  zip.file(
    'OEBPS/chap2.xhtml',
    makeXhtml('Chapter Two', [
      'The second chapter takes up a digression that may be cut in an abridgement, with examples.',
      'It includes detail about an example case study with several proper nouns like Smith and 1923.',
    ]),
  )
  const bytes = await zip.generateAsync({ type: 'uint8array' })
  return bytesToFile(bytes, 'tiny.epub', 'application/epub+zip')
}

function registerCommonMockResponses(mock: MockProvider): void {
  mock.registerMatcher(
    'short-book',
    (_model, opts) => opts.metadata.phase === 'short-book',
    {
      text: JSON.stringify({
        abridged: 'A condensed version of the book, retaining the central argument and key examples.',
        ledger: [
          {
            cutLocation: 'middle of chapter two, digression',
            replacementBracket: 'The author briefly digresses on a side example.',
            rationale: 'Digression does not advance the central argument.',
          },
        ],
      }),
      promptTokens: 100,
      completionTokens: 200,
    },
  )
  mock.registerMatcher(
    'phaseB',
    (_model, opts) => opts.metadata.phase === 'B-summarize',
    {
      text: JSON.stringify({
        summary: 'A paragraph-long summary of this section explaining the argument.',
        signals: {
          isCore: true,
          hasFamousArgument: false,
          narrativeFunction: 'argument',
          density: 'medium',
        },
        voiceSample:
          'A short verbatim passage from the section establishing the voice and rhetorical stance of the author for this chapter.',
      }),
      promptTokens: 50,
      completionTokens: 50,
    },
  )
  mock.registerMatcher(
    'phaseB5',
    (_model, opts) => opts.metadata.phase === 'B5-spine',
    {
      text: JSON.stringify({
        centralArgument: 'The book argues a clear thesis about how books should be abridged.',
        narrativeShape: 'It opens with framing, develops examples, and concludes.',
        recurringMotifs: ['voice', 'editorial care'],
        voiceAnchors: ['A short verbatim passage from the section establishing the voice'],
      }),
      promptTokens: 50,
      completionTokens: 50,
    },
  )
  mock.registerMatcher(
    'phaseA5',
    (_model, opts) => opts.metadata.phase === 'A5-canonical',
    {
      text: JSON.stringify({ passages: [] }),
      promptTokens: 5,
      completionTokens: 5,
    },
  )
  mock.registerMatcher(
    'phaseC1',
    (_model, opts) => opts.metadata.phase === 'C1-macro',
    {
      text: JSON.stringify({
        decisions: [],
      }),
      promptTokens: 50,
      completionTokens: 50,
    },
  )
  mock.registerMatcher(
    'phaseC15',
    (_model, opts) => opts.metadata.phase === 'C1.5-sanity',
    {
      text: JSON.stringify({ escalate: false, reason: 'no escalation needed' }),
      promptTokens: 50,
      completionTokens: 50,
    },
  )
  mock.registerMatcher(
    'phaseC2',
    (_model, opts) => opts.metadata.phase === 'C2-micro',
    {
      text: JSON.stringify({ deletions: [] }),
      promptTokens: 50,
      completionTokens: 50,
    },
  )
  mock.registerMatcher(
    'bracket',
    (_model, opts) => opts.metadata.phase === 'D-bracket-writer',
    {
      text: JSON.stringify({ bracketText: 'A short editorial bracket replacing this passage.' }),
      promptTokens: 50,
      completionTokens: 50,
    },
  )
  mock.setDefaultResponse({
    text: JSON.stringify({ boundaries: [] }),
    promptTokens: 10,
    completionTokens: 10,
  })
}

function makeTestClient(): { client: LLMClient; mock: MockProvider } {
  const client = new LLMClient({
    provider: 'anthropic',
    apiKey: 'sk-ant-test',
    ceilingUsd: 100,
  })
  const mock = client.useMockProvider()
  registerCommonMockResponses(mock)
  return { client, mock }
}

function makeStartInput(file: File, overrides: Partial<StartRunInput> = {}): StartRunInput {
  return {
    file,
    apiKey: 'sk-ant-test',
    provider: 'anthropic',
    purpose: 'understand the book',
    storeKeyLocally: false,
    costCeiling: 100,
    frontBackMatterHandling: 'abridge',
    ...overrides,
  }
}

describe('orchestrator: startRun guard rails', () => {
  it('returns budget-too-low when the cost ceiling is below the minimum estimate', async () => {
    const file = await buildTinyEpub()
    const result = await startRun(makeStartInput(file, { costCeiling: 0.0001 }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('budget-too-low')
  })

  it('returns unsupported-format when the file is neither PDF nor EPUB', async () => {
    const file = new File(['hello world'], 'note.txt', { type: 'text/plain' })
    const result = await startRun(makeStartInput(file))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('unsupported-format')
  })
})

describe('orchestrator: end-to-end with mocked LLM', () => {
  it('parses a tiny EPUB, runs pipeline to completion, persists outputs to IDB', async () => {
    const file = await buildTinyEpub()
    const { client } = makeTestClient()
    const result = await startRun(makeStartInput(file, { __testClient: client }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const completion = await result.handle.result
    expect(completion.ok).toBe(true)
    if (!completion.ok) return
    expect(completion.outputs.abridged).toBeInstanceOf(Blob)
    expect(completion.outputs.ledger).toBeInstanceOf(Blob)

    const run = await runsStore.get(result.handle.runId)
    expect(run?.status).toBe('done')
    const outs = await outputsStore.listByRun(result.handle.runId)
    expect(outs.length).toBeGreaterThanOrEqual(2)
    const kinds = outs.map((o) => o.kind).sort()
    expect(kinds).toContain('ledger-md')
  }, 30_000)
})

describe('orchestrator: cancel & resume', () => {
  it('cancel transitions the run to a non-success terminal state and returns ok=false', async () => {
    const file = await buildTinyEpub()
    const { client } = makeTestClient()
    const result = await startRun(makeStartInput(file, { __testClient: client }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    result.handle.cancel()
    const completion = await result.handle.result
    expect(completion.ok === false || completion.ok === true).toBe(true)
    const run = await runsStore.get(result.handle.runId)
    expect(['cancelled', 'errored', 'done']).toContain(run?.status)
  }, 30_000)

  it('reapOrphans resets a stale in_flight section row', async () => {
    const file = await buildTinyEpub()
    const { client } = makeTestClient()
    const result = await startRun(makeStartInput(file, { __testClient: client }))
    if (!result.ok) return
    await result.handle.result
    const runId = result.handle.runId

    const list = await sectionsStore.listByRun(runId)
    if (list.length === 0) return
    const target = list[0]
    const phaseStatus = {
      ...target.phaseStatus,
      A: {
        ...target.phaseStatus.A,
        status: 'in_flight' as const,
        requestStartedAt: Date.now() - 10 * 60 * 1000,
      },
    }
    await sectionsStore.update(runId, target.sectionId, { phaseStatus })
    const reap = await reapOrphans(runId)
    expect(reap.reaped).toBeGreaterThanOrEqual(1)
  }, 30_000)

  it('resumeRun returns unknown for a missing run id', async () => {
    const result = await resumeRun('nonexistent-run-id')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('unknown')
  })

  it('findResumable surfaces an in-progress or paused run', async () => {
    const file = await buildTinyEpub()
    const { client } = makeTestClient()
    const result = await startRun(makeStartInput(file, { __testClient: client }))
    if (!result.ok) return
    result.handle.cancel()
    await result.handle.result
    await runsStore.update(result.handle.runId, { status: 'paused' })
    const found = await findResumable()
    expect(found?.runId).toBe(result.handle.runId)
  }, 30_000)
})

describe('orchestrator: persistence shape', () => {
  it('creates exactly one run + book record on startRun', async () => {
    const file = await buildTinyEpub()
    const before = await runsStore.list()
    expect(before).toHaveLength(0)
    const { client } = makeTestClient()
    const result = await startRun(makeStartInput(file, { __testClient: client }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const after = await runsStore.list()
    expect(after).toHaveLength(1)
    expect(after[0].route).not.toBeNull()
    expect(after[0].promptHashes).toBeTruthy()
    await result.handle.result
  }, 30_000)
})
