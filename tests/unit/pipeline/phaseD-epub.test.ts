import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'

import type { Block, ParsedBook } from '@/parsers/types'
import { reconstructEpub } from '@/pipeline/phaseD-reconstruct/epub'
import type {
  BookContext,
  MacroDecision,
  MicroDecision,
  NarrativeSpine,
  Section,
} from '@/pipeline/types'

import { makeClient } from './fixtures'

const NS_OPF = 'http://www.idpf.org/2007/opf'

const SPINE: NarrativeSpine = {
  centralArgument: 'The book argues a thing.',
  narrativeShape: 'Opens, develops, lands.',
  recurringMotifs: ['motif-a'],
  voiceAnchors: ['voice anchor passage of more than thirty words used as a voice anchor here.'],
}

function makeContainerXml(opfPath: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="${opfPath}" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`
}

function makeOpfXml(version: '2.0' | '3.0', items: Array<{ id: string; href: string }>): string {
  const manifestItems = items
    .map((i) => `<item id="${i.id}" href="${i.href}" media-type="application/xhtml+xml"/>`)
    .join('\n    ')
  const spineItems = items.map((i) => `<itemref idref="${i.id}"/>`).join('\n    ')
  const tocAttr = version === '2.0' ? ' toc="ncx"' : ''
  const v2NcxManifest = version === '2.0' ? '\n    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>' : ''
  return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="${NS_OPF}" version="${version}" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Test Book</dc:title>
    <dc:creator>Test Author</dc:creator>
    <dc:identifier id="bookid">test-${version}</dc:identifier>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
    ${manifestItems}${v2NcxManifest}
  </manifest>
  <spine${tocAttr}>
    ${spineItems}
  </spine>
</package>`
}

function makeXhtml(title: string, paragraphs: string[]): string {
  const body = paragraphs.map((p) => `<p>${p}</p>`).join('\n    ')
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>${title}</title></head>
<body>
    ${body}
</body>
</html>`
}

async function buildFakeEpub(version: '2.0' | '3.0'): Promise<{ blob: Blob; opfPath: string }> {
  const zip = new JSZip()
  const opfPath = 'OEBPS/content.opf'
  zip.file('mimetype', 'application/epub+zip')
  zip.file('META-INF/container.xml', makeContainerXml(opfPath))
  const items = [
    { id: 'chap1', href: 'chap1.xhtml' },
    { id: 'chap2', href: 'chap2.xhtml' },
    { id: 'chap3', href: 'chap3.xhtml' },
  ]
  zip.file(opfPath, makeOpfXml(version, items))
  zip.file('OEBPS/chap1.xhtml', makeXhtml('Chapter 1', [
    'Opening paragraph one with several sentences. It establishes a setting.',
    'Second paragraph here. With more sentences to fill space and exposition.',
    'Third paragraph in chapter one. With closing notes.',
  ]))
  zip.file('OEBPS/chap2.xhtml', makeXhtml('Chapter 2', [
    'This chapter is the digression. Mao Zedong is mentioned here. In 1959.',
    'A second paragraph in the digression. Sichuan and Henan are mentioned.',
  ]))
  zip.file('OEBPS/chap3.xhtml', makeXhtml('Chapter 3', [
    'Closing chapter paragraph one with a sentence here.',
    'Closing chapter paragraph two with another sentence.',
  ]))
  if (version === '2.0') {
    zip.file('OEBPS/toc.ncx', '<?xml version="1.0"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head/><docTitle><text>Test</text></docTitle><navMap/></ncx>')
  }
  const blob = await zip.generateAsync({ type: 'blob' })
  return { blob, opfPath }
}

function makeBlock(
  id: string,
  text: string,
  pageNumber: number,
  spineItemId: string,
  domPath: string,
): Block {
  return {
    id,
    text,
    classification: 'body',
    pageNumber,
    spineItemId,
    domPath,
  }
}

function makeSectionForChapter(
  id: string,
  order: number,
  title: string,
  pageNumber: number,
  spineItemId: string,
  paragraphs: string[],
): Section {
  const blocks = paragraphs.map((p, i) =>
    makeBlock(
      `${pageNumber}-${i}`,
      p,
      pageNumber,
      spineItemId,
      `/html[1]/body[1]/p[${i + 1}]`,
    ),
  )
  return {
    id,
    order,
    title,
    startPage: pageNumber,
    endPage: pageNumber,
    blocks,
    rawText: paragraphs.join('\n\n'),
    summary: `Summary of ${title}`,
    voiceSample: 'voice sample text for this section',
    source: 'spine',
    confidence: 0.9,
  }
}

function makeParsedBook(version: '3.0' | '2.0', sections: Section[]): ParsedBook {
  return {
    id: 'test-book',
    format: 'epub',
    title: 'Test Book',
    author: 'Test Author',
    pages: sections.map((s) => ({
      number: s.startPage,
      blocks: s.blocks,
    })),
    rawText: sections.map((s) => s.rawText).join('\n\n'),
    matter: { detected: [] },
    spine: [
      { id: 'chap1', href: 'chap1.xhtml', mediaType: 'application/xhtml+xml' },
      { id: 'chap2', href: 'chap2.xhtml', mediaType: 'application/xhtml+xml' },
      { id: 'chap3', href: 'chap3.xhtml', mediaType: 'application/xhtml+xml' },
    ],
    epubVersion: version,
    warnings: [],
  }
}

function makeCtx(sections: Section[]): BookContext {
  return {
    purpose: 'understand the test book',
    spine: SPINE,
    canonicalPassages: [],
    allSectionSummaries: sections.map((s) => ({
      id: s.id,
      title: s.title,
      order: s.order,
      summary: s.summary,
      signals: s.signals,
    })),
  }
}

function buildSections(): Section[] {
  return [
    makeSectionForChapter('sec-1', 1, 'Chapter 1', 1, 'chap1', [
      'Opening paragraph one with several sentences. It establishes a setting.',
      'Second paragraph here. With more sentences to fill space and exposition.',
      'Third paragraph in chapter one. With closing notes.',
    ]),
    makeSectionForChapter('sec-2', 2, 'Chapter 2', 2, 'chap2', [
      'This chapter is the digression. Mao Zedong is mentioned here. In 1959.',
      'A second paragraph in the digression. Sichuan and Henan are mentioned.',
    ]),
    makeSectionForChapter('sec-3', 3, 'Chapter 3', 3, 'chap3', [
      'Closing chapter paragraph one with a sentence here.',
      'Closing chapter paragraph two with another sentence.',
    ]),
  ]
}

async function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof (blob as { arrayBuffer?: () => Promise<ArrayBuffer> }).arrayBuffer === 'function') {
    return blob.arrayBuffer()
  }
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'))
    reader.readAsArrayBuffer(blob)
  })
}

async function runForVersion(version: '2.0' | '3.0'): Promise<{
  zip: JSZip
  bracketTexts: { sectionId: string; deletionIndex: number; bracketText: string }[]
  stats: { originalPages: number; abridgedPages: number; sectionsKept: number; sectionsBracketed: number; microCuts: number }
  opfPath: string
}> {
  const { blob, opfPath } = await buildFakeEpub(version)
  const sections = buildSections()
  const parsedBook = makeParsedBook(version, sections)
  const macroDecisions: MacroDecision[] = [
    {
      sectionId: 'sec-1',
      verdict: 'KEEP_PARTIAL',
      rationale: 'keeps setting; trim digression',
      forwardDependencies: [],
      backwardDependencies: [],
      confidence: 0.8,
    },
    {
      sectionId: 'sec-2',
      verdict: 'COMPRESS_TO_BRACKET',
      rationale: 'digression — compress to a bracket',
      forwardDependencies: [],
      backwardDependencies: [],
      bracketLengthHint: 'short',
      confidence: 0.9,
    },
    {
      sectionId: 'sec-3',
      verdict: 'KEEP_FULL',
      rationale: 'closing chapter, keep entirely',
      forwardDependencies: [],
      backwardDependencies: [],
      confidence: 0.95,
    },
  ]
  const microDecisions: MicroDecision[] = [
    {
      sectionId: 'sec-1',
      deletions: [
        {
          startOffset: 0,
          endOffset: 70,
          containedBlockIds: ['1-1'],
          dropRationale: 'trim the middle paragraph',
          bracketLengthHint: 'short',
        },
      ],
      rejectedDeletions: [],
    },
  ]
  const ctx = makeCtx(sections)
  const client = makeClient()
  const mock = client.useMockProvider()
  mock.setDefaultResponse({
    text: JSON.stringify({
      bracketText: 'BRACKET_TEXT_FOR_TEST',
    }),
    promptTokens: 100,
    completionTokens: 50,
  })
  const result = await reconstructEpub(
    {
      originalBlob: blob,
      parsedBook,
      sections,
      macroDecisions,
      microDecisions,
      ctx,
      client,
    },
    { bracketConcurrency: 2 },
  )
  const zip = await JSZip.loadAsync(await blobToArrayBuffer(result.abridgedBlob))
  return { zip, bracketTexts: result.bracketTexts, stats: result.stats, opfPath }
}

describe('reconstructEpub', () => {
  it('produces an abridged EPUB 3 with bracket asides and abridger.css', async () => {
    const { zip, bracketTexts, stats } = await runForVersion('3.0')
    expect(zip.file('OEBPS/abridger.css')).not.toBeNull()
    const css = await zip.file('OEBPS/abridger.css')!.async('string')
    expect(css).toContain('.abridger-bracket')

    const chap2 = await zip.file('OEBPS/chap2.xhtml')!.async('string')
    expect(chap2).toContain('abridger-bracket--macro')
    expect(chap2).toContain('BRACKET_TEXT_FOR_TEST')

    const chap1 = await zip.file('OEBPS/chap1.xhtml')!.async('string')
    expect(chap1).toContain('abridger-bracket--micro')
    expect(chap1).toContain('BRACKET_TEXT_FOR_TEST')

    expect(bracketTexts.some((b) => b.sectionId === 'sec-2' && b.deletionIndex === -1)).toBe(true)
    expect(bracketTexts.some((b) => b.sectionId === 'sec-1' && b.deletionIndex === 0)).toBe(true)

    expect(stats.originalPages).toBe(3)
    expect(stats.sectionsBracketed).toBe(1)
    expect(stats.microCuts).toBe(1)
  })

  it('produces an abridged EPUB 2 with the same structural changes', async () => {
    const { zip, stats } = await runForVersion('2.0')
    expect(zip.file('OEBPS/abridger.css')).not.toBeNull()
    const chap2 = await zip.file('OEBPS/chap2.xhtml')!.async('string')
    expect(chap2).toContain('abridger-bracket--macro')
    expect(stats.sectionsBracketed).toBe(1)
  })

  it('injects the stylesheet manifest entry into the OPF', async () => {
    const { zip, opfPath } = await runForVersion('3.0')
    const opfXml = await zip.file(opfPath)!.async('string')
    expect(opfXml).toContain('abridger.css')
    expect(opfXml).toContain('text/css')
  })

  it('keeps untouched sections verbatim', async () => {
    const { zip } = await runForVersion('3.0')
    const chap3 = await zip.file('OEBPS/chap3.xhtml')!.async('string')
    expect(chap3).toContain('Closing chapter paragraph one')
    expect(chap3).toContain('Closing chapter paragraph two')
    expect(chap3).not.toContain('abridger-bracket')
  })

  it('throws when parsedBook is not an EPUB', async () => {
    const client = makeClient()
    client.useMockProvider()
    await expect(
      reconstructEpub({
        originalBlob: new Blob(),
        parsedBook: {
          id: 'x',
          format: 'pdf',
          pages: [],
          rawText: '',
          matter: { detected: [] },
          warnings: [],
        },
        sections: [],
        macroDecisions: [],
        microDecisions: [],
        ctx: {
          purpose: 'test',
          spine: SPINE,
          canonicalPassages: [],
          allSectionSummaries: [],
        },
        client,
      }),
    ).rejects.toThrow(/epub/i)
  })
})
