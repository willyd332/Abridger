import { LLMClient } from '@/llm/client'
import type { Block, ParsedBook } from '@/parsers/types'

export function makeBlock(opts: {
  id: string
  text: string
  pageNumber: number
  classification?: Block['classification']
  spineItemId?: string
}): Block {
  return {
    id: opts.id,
    text: opts.text,
    classification: opts.classification ?? 'body',
    pageNumber: opts.pageNumber,
    spineItemId: opts.spineItemId,
  }
}

export function makePdfBook(opts: {
  id?: string
  title?: string
  author?: string
  pageCount: number
  textPerPage: (pageNumber: number) => string
}): ParsedBook {
  const pages = Array.from({ length: opts.pageCount }, (_, i) => {
    const pageNumber = i + 1
    const text = opts.textPerPage(pageNumber)
    const block = makeBlock({
      id: `${pageNumber}-0`,
      text,
      pageNumber,
    })
    return { number: pageNumber, blocks: [block] }
  })
  const rawText = pages
    .flatMap((p) => p.blocks.filter((b) => b.classification === 'body').map((b) => b.text))
    .join('\n')
    .trim()
  return {
    id: opts.id ?? 'pdf-test',
    format: 'pdf',
    title: opts.title,
    author: opts.author,
    pages,
    rawText,
    matter: { detected: [] },
    warnings: [],
  }
}

export function makeEpubBook(opts: {
  id?: string
  title?: string
  author?: string
  spineItems: Array<{ id: string; href: string; text: string }>
}): ParsedBook {
  const pages = opts.spineItems.map((s, i) => {
    const pageNumber = i + 1
    const block = makeBlock({
      id: `${pageNumber}-0`,
      text: s.text,
      pageNumber,
      spineItemId: s.id,
    })
    return { number: pageNumber, blocks: [block] }
  })
  const rawText = pages
    .flatMap((p) => p.blocks.filter((b) => b.classification === 'body').map((b) => b.text))
    .join('\n')
    .trim()
  return {
    id: opts.id ?? 'epub-test',
    format: 'epub',
    title: opts.title,
    author: opts.author,
    pages,
    rawText,
    matter: { detected: [] },
    spine: opts.spineItems.map((s) => ({ id: s.id, href: s.href, mediaType: 'application/xhtml+xml' })),
    epubVersion: '3.0',
    warnings: [],
  }
}

export function makeClient(): LLMClient {
  return new LLMClient({
    provider: 'anthropic',
    apiKey: 'sk-ant-test',
    ceilingUsd: 100,
  })
}
