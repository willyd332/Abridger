import JSZip from 'jszip'

import { classifyMatter } from './frontmatter'
import { classifyProtected } from './protected-blocks'
import type {
  Block,
  BlockClassification,
  Page,
  ParseResult,
  ParsedBook,
  SpineEntry,
} from './types'

const CONTAINER_PATH = 'META-INF/container.xml'
const ENCRYPTION_PATH = 'META-INF/encryption.xml'

const NAMESPACE = {
  container: 'urn:oasis:names:tc:opendocument:xmlns:container',
  opf: 'http://www.idpf.org/2007/opf',
  dc: 'http://purl.org/dc/elements/1.1/',
}

const BODY_TAGS = new Set([
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'li',
  'blockquote',
  'pre',
  'div',
])

const PRE_TAGS = new Set(['pre', 'code'])
const CAPTION_PREFIX_RE = /^(figure|fig\.|table|plate|diagram|map)\b/i

const generateBookId = (): string => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `epub-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

const getDomParser = (): DOMParser => {
  if (typeof DOMParser === 'undefined') {
    throw new Error('DOMParser is not available in this environment.')
  }
  return new DOMParser()
}

type XmlMime = 'application/xml' | 'application/xhtml+xml' | 'text/xml' | 'text/html' | 'image/svg+xml'

const parseXml = (text: string, mime: XmlMime): Document => {
  const doc = getDomParser().parseFromString(text, mime)
  const errorNode = doc.getElementsByTagName('parsererror')[0]
  if (errorNode) {
    throw new Error(`Failed to parse XML: ${errorNode.textContent ?? 'parsererror'}`)
  }
  return doc
}

const resolvePath = (basePath: string, relative: string): string => {
  if (relative.startsWith('/')) return relative.replace(/^\//, '')
  const baseParts = basePath.split('/').slice(0, -1)
  const relParts = relative.split('/')
  for (const part of relParts) {
    if (part === '.' || part === '') continue
    if (part === '..') {
      baseParts.pop()
      continue
    }
    baseParts.push(part)
  }
  return baseParts.join('/')
}

const readStringFromZip = async (
  zip: JSZip,
  path: string,
): Promise<string | undefined> => {
  const file = zip.file(path)
  if (!file) return undefined
  return file.async('string')
}

const findOpfPath = async (zip: JSZip): Promise<string | undefined> => {
  const container = await readStringFromZip(zip, CONTAINER_PATH)
  if (!container) return undefined
  const doc = parseXml(container, 'application/xml')
  const rootfile = doc.getElementsByTagNameNS(NAMESPACE.container, 'rootfile')[0]
  return rootfile?.getAttribute('full-path') ?? undefined
}

type OpfData = {
  version?: string
  title?: string
  author?: string
  manifest: Map<string, { href: string; mediaType: string }>
  spineItemIds: string[]
}

const parseOpf = (opfXml: string): OpfData => {
  const doc = parseXml(opfXml, 'application/xml')
  const pkg = doc.documentElement
  const version = pkg?.getAttribute('version') ?? undefined

  const titles = doc.getElementsByTagNameNS(NAMESPACE.dc, 'title')
  const creators = doc.getElementsByTagNameNS(NAMESPACE.dc, 'creator')
  const title = titles[0]?.textContent?.trim() || undefined
  const author = creators[0]?.textContent?.trim() || undefined

  const manifest = new Map<string, { href: string; mediaType: string }>()
  const items = doc.getElementsByTagNameNS(NAMESPACE.opf, 'item')
  for (const item of Array.from(items)) {
    const id = item.getAttribute('id')
    const href = item.getAttribute('href')
    const mediaType = item.getAttribute('media-type') ?? ''
    if (id && href) manifest.set(id, { href, mediaType })
  }

  const spineItemIds: string[] = []
  const spineItems = doc.getElementsByTagNameNS(NAMESPACE.opf, 'itemref')
  for (const item of Array.from(spineItems)) {
    const idref = item.getAttribute('idref')
    if (idref) spineItemIds.push(idref)
  }

  return { version, title, author, manifest, spineItemIds }
}

type DomPathSegment = { tag: string; index: number }

const xpathFor = (element: Element): string => {
  const segments: DomPathSegment[] = []
  let current: Element | null = element
  while (current && current.nodeType === 1) {
    const parent: Element | null = current.parentElement
    if (!parent) {
      segments.unshift({ tag: current.tagName.toLowerCase(), index: 1 })
      break
    }
    let index = 1
    let sibling: Element | null = current.previousElementSibling
    while (sibling) {
      if (sibling.tagName === current.tagName) index += 1
      sibling = sibling.previousElementSibling
    }
    segments.unshift({ tag: current.tagName.toLowerCase(), index })
    current = parent
  }
  return '/' + segments.map((s) => `${s.tag}[${s.index}]`).join('/')
}

const elementText = (element: Element): string => {
  return (element.textContent ?? '').replace(/\s+/g, ' ').trim()
}

const classifyEpubBlock = (
  element: Element,
  text: string,
  isPreContext: boolean,
): BlockClassification => {
  if (isPreContext) return 'protected'
  const tag = element.tagName.toLowerCase()
  if (tag === 'pre' || tag === 'code') return 'protected'
  if (element.querySelector('math, img.math, .math')) return 'protected'
  if (tag.match(/^h[1-6]$/)) return 'body'
  if (tag === 'figcaption') return 'caption'
  if (CAPTION_PREFIX_RE.test(text) && text.length < 200) return 'caption'
  if (element.classList.contains('footnote')) return 'footnote'
  return 'body'
}

const walkBodyBlocks = (
  doc: Document,
  spineItemId: string,
  pageNumber: number,
): Block[] => {
  const body = doc.body ?? doc.getElementsByTagName('body')[0]
  if (!body) return []
  const blocks: Block[] = []
  let blockIndex = 0
  const selector = Array.from(BODY_TAGS).join(',')
  const candidates = body.querySelectorAll(selector)
  for (const element of Array.from(candidates)) {
    const tag = element.tagName.toLowerCase()
    if (BODY_TAGS.has(tag) === false) continue
    if (
      tag === 'div' &&
      element.querySelector(Array.from(BODY_TAGS).filter((t) => t !== 'div').join(','))
    ) {
      continue
    }
    const text = elementText(element)
    if (!text) continue
    const isPre =
      PRE_TAGS.has(tag) ||
      (element.closest && element.closest('pre, code') !== null)
    const classification = classifyEpubBlock(element, text, Boolean(isPre))
    blocks.push({
      id: `${pageNumber}-${blockIndex}`,
      text,
      classification,
      pageNumber,
      spineItemId,
      domPath: xpathFor(element),
    })
    blockIndex += 1
  }
  return blocks
}

const fontLookupForEpub = (preIds: Set<string>) => (block: Block): string | undefined => {
  return preIds.has(block.id) ? 'monospace' : undefined
}

const buildPagesFromSpine = async (
  zip: JSZip,
  opf: OpfData,
  opfPath: string,
  warnings: string[],
): Promise<{ pages: Page[]; spine: SpineEntry[] }> => {
  const pages: Page[] = []
  const spine: SpineEntry[] = []
  let pageNumber = 1
  for (const idref of opf.spineItemIds) {
    const manifestEntry = opf.manifest.get(idref)
    if (!manifestEntry) {
      warnings.push(`Spine item ${idref} missing from manifest.`)
      continue
    }
    const path = resolvePath(opfPath, manifestEntry.href)
    spine.push({ id: idref, href: manifestEntry.href, mediaType: manifestEntry.mediaType })
    const xhtml = await readStringFromZip(zip, path)
    if (!xhtml) {
      warnings.push(`Spine item ${idref} (${path}) could not be read.`)
      pages.push({ number: pageNumber, blocks: [] })
      pageNumber += 1
      continue
    }
    let doc: Document
    try {
      doc = parseXml(xhtml, 'application/xhtml+xml')
    } catch {
      try {
        doc = getDomParser().parseFromString(xhtml, 'text/html')
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        warnings.push(`Spine item ${idref} parse failed: ${message}`)
        pages.push({ number: pageNumber, blocks: [] })
        pageNumber += 1
        continue
      }
    }
    const blocks = walkBodyBlocks(doc, idref, pageNumber)
    const preIds = new Set(
      blocks.filter((b) => b.classification === 'protected').map((b) => b.id),
    )
    const protectedBlocks = classifyProtected(blocks, {
      fontLookup: fontLookupForEpub(preIds),
    })
    pages.push({ number: pageNumber, blocks: protectedBlocks })
    pageNumber += 1
  }
  return { pages, spine }
}

export type ParseEpubOptions = {
  signal?: AbortSignal
}

const abortedResult = (): ParseResult => ({
  ok: false,
  reason: 'unknown',
  message: 'EPUB parse aborted.',
})

const toLoadableData = async (
  source: File | Blob | ArrayBuffer | Uint8Array,
): Promise<ArrayBuffer | Uint8Array> => {
  if (source instanceof Uint8Array) return source
  if (source instanceof ArrayBuffer) return source
  return source.arrayBuffer()
}

export const parseEpub = async (
  file: File | Blob,
  opts: ParseEpubOptions = {},
): Promise<ParseResult> => {
  const warnings: string[] = []
  const { signal } = opts
  if (signal?.aborted) return abortedResult()

  let zip: JSZip
  try {
    const data = await toLoadableData(file)
    zip = await JSZip.loadAsync(data)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      ok: false,
      reason: 'corrupt',
      message: `EPUB archive could not be opened: ${message}`,
    }
  }

  if (zip.file(ENCRYPTION_PATH)) {
    return {
      ok: false,
      reason: 'drm-protected',
      message: 'This EPUB is DRM-protected and cannot be parsed.',
    }
  }

  const opfPath = await findOpfPath(zip)
  if (!opfPath) {
    return {
      ok: false,
      reason: 'corrupt',
      message: 'EPUB container.xml missing or rootfile not declared.',
    }
  }

  const opfXml = await readStringFromZip(zip, opfPath)
  if (!opfXml) {
    return {
      ok: false,
      reason: 'corrupt',
      message: `EPUB package file ${opfPath} could not be read.`,
    }
  }

  let opf: OpfData
  try {
    opf = parseOpf(opfXml)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      ok: false,
      reason: 'corrupt',
      message: `EPUB package file could not be parsed: ${message}`,
    }
  }

  if (opf.spineItemIds.length === 0) {
    return {
      ok: false,
      reason: 'corrupt',
      message: 'EPUB spine is empty.',
    }
  }

  const { pages, spine } = await buildPagesFromSpine(zip, opf, opfPath, warnings)

  const rawText = pages
    .flatMap((p) => p.blocks.filter((b) => b.classification === 'body').map((b) => b.text))
    .join('\n')
    .trim()

  const draft: ParsedBook = {
    id: generateBookId(),
    format: 'epub',
    title: opf.title,
    author: opf.author,
    pages,
    rawText,
    matter: { detected: [] },
    spine,
    epubVersion: opf.version,
    warnings,
  }
  const book: ParsedBook = { ...draft, matter: classifyMatter(draft) }

  return { ok: true, book }
}
