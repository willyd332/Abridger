import { describe, expect, it } from 'vitest'

import { phaseA5Canonical } from '@/pipeline/phaseA5-canonical'

import { makeClient, makePdfBook } from './fixtures'

describe('phaseA5Canonical', () => {
  it('returns empty array when book title is missing without calling the LLM', async () => {
    const book = makePdfBook({
      pageCount: 5,
      textPerPage: (p) => `Page ${p} body.`,
    })
    const client = makeClient()
    const mock = client.useMockProvider()
    const result = await phaseA5Canonical(book, client)
    expect(result).toEqual([])
    expect(mock.callCount()).toBe(0)
  })

  it('keeps validated passages and drops unverified ones', async () => {
    const book = makePdfBook({
      title: 'Sample Treatise',
      author: 'Anon',
      pageCount: 3,
      textPerPage: (p) => {
        if (p === 1) return 'The unexamined life is not worth living, said the philosopher.'
        if (p === 2) return 'Page two text continues onward with various claims.'
        return 'Final page summarises the argument.'
      },
    })
    const client = makeClient()
    const mock = client.useMockProvider()
    mock.setDefaultResponse({
      text: JSON.stringify({
        passages: [
          {
            description:
              'A famous quote: "the unexamined life is not worth living" comes from the philosopher.',
            pageOrSectionRef: 'Chapter 1',
          },
          {
            description:
              'A fake quote: "this exact phrase does not appear anywhere in the book at all"',
            pageOrSectionRef: 'Chapter 2',
          },
        ],
      }),
      promptTokens: 5,
      completionTokens: 10,
    })
    const result = await phaseA5Canonical(book, client)
    expect(result).toHaveLength(1)
    expect(result[0].validated).toBe(true)
    expect(result[0].matchedSnippet).toBeDefined()
    expect(result[0].pageOrSectionRef).toBe('Chapter 1')
  })

  it('returns both validated and unvalidated when includeUnvalidated is true', async () => {
    const book = makePdfBook({
      title: 'Sample',
      pageCount: 1,
      textPerPage: () => 'The actual body of the book contains some real content here today.',
    })
    const client = makeClient()
    const mock = client.useMockProvider()
    mock.setDefaultResponse({
      text: JSON.stringify({
        passages: [
          {
            description: 'A fake quote: "this phrase is definitely not present in the body"',
            pageOrSectionRef: 'Chapter 1',
          },
        ],
      }),
      promptTokens: 5,
      completionTokens: 10,
    })
    const result = await phaseA5Canonical(book, client, { includeUnvalidated: true })
    expect(result).toHaveLength(1)
    expect(result[0].validated).toBe(false)
  })

  it('returns empty when LLM returns invalid JSON', async () => {
    const book = makePdfBook({
      title: 'Bad JSON Book',
      pageCount: 1,
      textPerPage: () => 'Body.',
    })
    const client = makeClient()
    const mock = client.useMockProvider()
    mock.setDefaultResponse({
      text: 'not json at all',
      promptTokens: 1,
      completionTokens: 1,
    })
    const result = await phaseA5Canonical(book, client)
    expect(result).toEqual([])
  })
})
