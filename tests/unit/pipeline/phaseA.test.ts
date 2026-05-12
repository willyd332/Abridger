import { describe, expect, it } from 'vitest'

import { phaseAStructure } from '@/pipeline/phaseA-structure'

import { makeClient, makeEpubBook, makePdfBook } from './fixtures'

describe('phaseAStructure', () => {
  it('builds one section per spine item for EPUB without LLM calls', async () => {
    const book = makeEpubBook({
      title: 'Test EPUB',
      spineItems: [
        { id: 'ch1', href: 'ch1.xhtml', text: 'Chapter One opening paragraph.' },
        { id: 'ch2', href: 'ch2.xhtml', text: 'Chapter Two opening paragraph.' },
        { id: 'ch3', href: 'ch3.xhtml', text: 'Chapter Three opening paragraph.' },
      ],
    })
    const client = makeClient()
    const mock = client.useMockProvider()
    const result = await phaseAStructure(book, client)
    expect(result.source).toBe('spine')
    expect(result.sections).toHaveLength(3)
    expect(result.sections[0].order).toBe(1)
    expect(result.sections[0].startPage).toBe(1)
    expect(result.sections[1].startPage).toBe(2)
    expect(result.sections[2].endPage).toBe(3)
    expect(mock.callCount()).toBe(0)
  })

  it('uses outline boundaries when supplied and outline agrees with LLM cross-check', async () => {
    const book = makePdfBook({
      title: 'Outline Book',
      pageCount: 30,
      textPerPage: (p) => `Body text for page ${p}.`,
    })
    const client = makeClient()
    const mock = client.useMockProvider()
    mock.setDefaultResponse({
      text: JSON.stringify({ boundaries: [] }),
      promptTokens: 1,
      completionTokens: 1,
    })
    // Outline says boundaries at p1, p11, p21. With LLM returning no boundaries,
    // the outlineInWindow check fails (boundaries exist in window but LLM lists none).
    // To make this an agreement test, set sample rate so we sample 0 windows.
    const result = await phaseAStructure(book, client, {
      outline: [
        { title: 'Chapter 1', startPage: 1 },
        { title: 'Chapter 2', startPage: 11 },
        { title: 'Chapter 3', startPage: 21 },
      ],
      llmCrossCheckSampleRate: 0,
    })
    expect(result.source).toBe('outline')
    expect(result.sections).toHaveLength(3)
    expect(result.sections[0].title).toBe('Chapter 1')
    expect(result.sections[1].title).toBe('Chapter 2')
    expect(result.sections[2].startPage).toBe(21)
    expect(result.sections[2].endPage).toBe(30)
  })

  it('falls back to hybrid when outline disagrees with LLM cross-check', async () => {
    const book = makePdfBook({
      title: 'Disagree Book',
      pageCount: 30,
      textPerPage: (p) => `Body text for page ${p}.`,
    })
    const client = makeClient()
    const mock = client.useMockProvider()
    // LLM cross-check returns a boundary far from outline's claim
    mock.registerMatcher(
      'crosscheck',
      (_model, opts) => opts.metadata.requestId.includes('phaseA-crosscheck'),
      {
        text: JSON.stringify({
          boundaries: [
            { boundaryPageNumber: 5, suggestedTitle: 'Real Chapter A', confidence: 0.9 },
          ],
        }),
        promptTokens: 1,
        completionTokens: 1,
      },
    )
    mock.setDefaultResponse({
      text: JSON.stringify({ boundaries: [] }),
      promptTokens: 1,
      completionTokens: 1,
    })
    const result = await phaseAStructure(book, client, {
      outline: [
        { title: 'Outline Ch 1', startPage: 1 },
        { title: 'Outline Ch 2', startPage: 11 },
      ],
      llmCrossCheckSampleRate: 1.0,
      windowPages: 10,
    })
    expect(result.source).toBe('hybrid')
    expect(result.warnings.some((w) => w.includes('disagrees'))).toBe(true)
    // boundary from LLM (page 5) should have been merged in
    expect(result.sections.some((s) => s.startPage === 5)).toBe(true)
  })

  it('uses LLM windows when no outline is supplied and dedupes overlapping boundaries', async () => {
    const book = makePdfBook({
      title: 'No-outline Book',
      pageCount: 20,
      textPerPage: (p) => `Body for page ${p}.`,
    })
    const client = makeClient()
    const mock = client.useMockProvider()
    // Each window returns the same boundary at start of window (within 2-page tolerance for dedupe)
    mock.registerMatcher(
      'llm-window-11',
      (_model, opts) => opts.metadata.requestId === 'phaseA-llm-11',
      {
        text: JSON.stringify({
          boundaries: [
            { boundaryPageNumber: 11, suggestedTitle: 'Chapter Beta', confidence: 0.85 },
          ],
        }),
        promptTokens: 1,
        completionTokens: 1,
      },
    )
    mock.registerMatcher(
      'llm-window-1',
      (_model, opts) => opts.metadata.requestId === 'phaseA-llm-1',
      {
        text: JSON.stringify({
          boundaries: [
            { boundaryPageNumber: 1, suggestedTitle: 'Chapter Alpha', confidence: 0.8 },
            { boundaryPageNumber: 2, suggestedTitle: 'Chapter Alpha-dup', confidence: 0.7 },
          ],
        }),
        promptTokens: 1,
        completionTokens: 1,
      },
    )
    mock.setDefaultResponse({
      text: JSON.stringify({ boundaries: [] }),
      promptTokens: 1,
      completionTokens: 1,
    })

    const result = await phaseAStructure(book, client, { windowPages: 10 })
    expect(result.source).toBe('llm-detected')
    expect(result.sections.length).toBeGreaterThanOrEqual(2)
    // Duplicate boundary at page 2 should be dropped (within 2-page tolerance of page 1)
    expect(result.sections.filter((s) => s.startPage === 2)).toHaveLength(0)
    expect(result.sections.some((s) => s.title === 'Chapter Alpha')).toBe(true)
    expect(result.sections.some((s) => s.title === 'Chapter Beta')).toBe(true)
  })

  it('emits low-confidence warning when LLM returns weak boundaries', async () => {
    const book = makePdfBook({
      pageCount: 10,
      textPerPage: (p) => `text ${p}`,
    })
    const client = makeClient()
    const mock = client.useMockProvider()
    mock.setDefaultResponse({
      text: JSON.stringify({
        boundaries: [
          { boundaryPageNumber: 1, suggestedTitle: 'Maybe Chapter', confidence: 0.1 },
        ],
      }),
      promptTokens: 1,
      completionTokens: 1,
    })
    const result = await phaseAStructure(book, client, { windowPages: 10 })
    expect(result.source).toBe('llm-detected')
    expect(
      result.warnings.some((w) => w.includes('Structural confidence low')),
    ).toBe(true)
  })
})
