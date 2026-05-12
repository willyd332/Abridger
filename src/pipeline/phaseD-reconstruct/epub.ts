import JSZip from 'jszip'

import { mapWithLimit } from '@/lib/concurrency'
import { LLMClient } from '@/llm/client'
import type { ParsedBook, Block } from '@/parsers/types'

import { writeBracket } from '../bracket-writer'
import { getPrecedingContext, getFollowingContext } from '../bracket-helpers'
import type {
  BookContext,
  Emit,
  MacroDecision,
  MicroDecision,
  Section,
} from '../types'

const PHASE_NAME = 'D-reconstruct-epub'
const DEFAULT_BRACKET_CONCURRENCY = 3

const CONTAINER_PATH = 'META-INF/container.xml'
const NAMESPACE = {
  container: 'urn:oasis:names:tc:opendocument:xmlns:container',
  opf: 'http://www.idpf.org/2007/opf',
  dc: 'http://purl.org/dc/elements/1.1/',
}

const ABRIDGER_CSS = `/* Abridger editorial brackets */
.abridger-bracket {
  display: block;
  margin: 1.5em 2em;
  padding: 0.75em 1em;
  background: #f5ecd6;
  border-left: 3px solid #b8860b;
  color: #4a3522;
  font-style: italic;
  font-size: 0.95em;
  line-height: 1.55;
}
.abridger-bracket--macro {
  margin: 2em 1em;
  padding: 1em 1.25em;
  font-size: 1em;
}
.abridger-bracket--macro::before {
  content: "[";
  font-style: normal;
  color: #8a6520;
}
.abridger-bracket--macro::after {
  content: "]";
  font-style: normal;
  color: #8a6520;
}
.abridger-bracket--micro::before {
  content: "[ ";
  font-style: normal;
  color: #8a6520;
}
.abridger-bracket--micro::after {
  content: " ]";
  font-style: normal;
  color: #8a6520;
}
`

export type ReconstructEpubInput = {
  originalBlob: Blob
  parsedBook: ParsedBook
  sections: Section[]
  macroDecisions: MacroDecision[]
  microDecisions: MicroDecision[]
  ctx: BookContext
  client: LLMClient
}

export type ReconstructedBracket = {
  sectionId: string
  deletionIndex: number
  bracketText: string
}

export type ReconstructEpubStats = {
  originalPages: number
  abridgedPages: number
  sectionsKept: number
  sectionsBracketed: number
  microCuts: number
}

export type ReconstructEpubOutput = {
  abridgedBlob: Blob
  bracketTexts: ReconstructedBracket[]
  stats: ReconstructEpubStats
}

export type ReconstructEpubOptions = {
  emit?: Emit
  signal?: AbortSignal
  bracketConcurrency?: number
}

type SpineEntry = {
  idref: string
  manifestId: string
  href: string
  path: string
}

type OpfData = {
  doc: Document
  version: string
  packageEl: Element
  manifestEl: Element
  spineEl: Element
  manifestEntries: Map<string, { id: string; href: string; mediaType: string }>
  spineRefs: string[]
}

const getDomParser = (): DOMParser => {
  if (typeof DOMParser === 'undefined') {
    throw new Error('DOMParser is not available in this environment.')
  }
  return new DOMParser()
}

async function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof (blob as { arrayBuffer?: () => Promise<ArrayBuffer> }).arrayBuffer === 'function') {
    return blob.arrayBuffer()
  }
  if (typeof FileReader !== 'undefined') {
    return new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as ArrayBuffer)
      reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'))
      reader.readAsArrayBuffer(blob)
    })
  }
  throw new Error('Cannot read Blob: no arrayBuffer or FileReader support.')
}

const getXmlSerializer = (): XMLSerializer => {
  if (typeof XMLSerializer === 'undefined') {
    throw new Error('XMLSerializer is not available in this environment.')
  }
  return new XMLSerializer()
}

function parseXml(text: string, mime: 'application/xml' | 'application/xhtml+xml' | 'text/html'): Document {
  const doc = getDomParser().parseFromString(text, mime)
  const errorNode = doc.getElementsByTagName('parsererror')[0]
  if (errorNode) {
    throw new Error(`Failed to parse XML: ${errorNode.textContent ?? 'parsererror'}`)
  }
  return doc
}

function resolvePath(basePath: string, relative: string): string {
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

async function readString(zip: JSZip, path: string): Promise<string | undefined> {
  const file = zip.file(path)
  if (!file) return undefined
  return file.async('string')
}

async function findOpfPath(zip: JSZip): Promise<string> {
  const container = await readString(zip, CONTAINER_PATH)
  if (!container) {
    throw new Error('EPUB container.xml missing.')
  }
  const doc = parseXml(container, 'application/xml')
  const rootfile = doc.getElementsByTagNameNS(NAMESPACE.container, 'rootfile')[0]
  const fullPath = rootfile?.getAttribute('full-path')
  if (!fullPath) {
    throw new Error('EPUB container.xml has no rootfile.')
  }
  return fullPath
}

async function readOpf(zip: JSZip, opfPath: string): Promise<OpfData> {
  const opfXml = await readString(zip, opfPath)
  if (!opfXml) throw new Error(`EPUB package file ${opfPath} could not be read.`)
  const doc = parseXml(opfXml, 'application/xml')
  const packageEl = doc.documentElement
  const version = packageEl?.getAttribute('version') ?? '2.0'

  const manifestEl = doc.getElementsByTagNameNS(NAMESPACE.opf, 'manifest')[0]
  const spineEl = doc.getElementsByTagNameNS(NAMESPACE.opf, 'spine')[0]
  if (!manifestEl || !spineEl) {
    throw new Error('EPUB OPF is missing manifest or spine.')
  }

  const manifestEntries = new Map<string, { id: string; href: string; mediaType: string }>()
  const items = doc.getElementsByTagNameNS(NAMESPACE.opf, 'item')
  for (const item of Array.from(items)) {
    const id = item.getAttribute('id')
    const href = item.getAttribute('href')
    const mediaType = item.getAttribute('media-type') ?? ''
    if (id && href) manifestEntries.set(id, { id, href, mediaType })
  }

  const spineRefs: string[] = []
  const itemrefs = doc.getElementsByTagNameNS(NAMESPACE.opf, 'itemref')
  for (const itemref of Array.from(itemrefs)) {
    const idref = itemref.getAttribute('idref')
    if (idref) spineRefs.push(idref)
  }

  return {
    doc,
    version,
    packageEl,
    manifestEl,
    spineEl,
    manifestEntries,
    spineRefs,
  }
}

function buildSpineEntries(opf: OpfData, opfPath: string): SpineEntry[] {
  const out: SpineEntry[] = []
  for (const idref of opf.spineRefs) {
    const entry = opf.manifestEntries.get(idref)
    if (!entry) continue
    out.push({
      idref,
      manifestId: entry.id,
      href: entry.href,
      path: resolvePath(opfPath, entry.href),
    })
  }
  return out
}

function xpathSegments(domPath: string): string[] {
  return domPath.split('/').filter((s) => s.length > 0)
}

function findElementByDomPath(doc: Document, domPath: string): Element | null {
  const segments = xpathSegments(domPath)
  if (segments.length === 0) return null
  const [first, ...rest] = segments
  const firstMatch = first.match(/^([a-zA-Z0-9]+)(?:\[(\d+)\])?$/)
  if (!firstMatch) return null
  const root = doc.documentElement
  if (!root || root.tagName.toLowerCase() !== firstMatch[1].toLowerCase()) return null
  let current: Element | null = root
  for (const seg of rest) {
    if (!current) return null
    const match = seg.match(/^([a-zA-Z0-9]+)(?:\[(\d+)\])?$/)
    if (!match) return null
    const tag = match[1].toLowerCase()
    const idx = match[2] ? parseInt(match[2], 10) : 1
    let count = 0
    let found: Element | null = null
    const childrenList: Element[] = Array.from(current.children) as Element[]
    for (const child of childrenList) {
      if (child.tagName.toLowerCase() === tag) {
        count += 1
        if (count === idx) {
          found = child
          break
        }
      }
    }
    current = found
  }
  return current
}

function createBracketAside(
  doc: Document,
  bracketText: string,
  scopeClass: 'macro' | 'micro',
): Element {
  const aside = doc.createElement('aside')
  aside.setAttribute('class', `abridger-bracket abridger-bracket--${scopeClass}`)
  aside.setAttribute('role', 'note')
  aside.textContent = bracketText
  return aside
}

function spineItemsForSection(section: Section, spineEntries: SpineEntry[]): SpineEntry[] {
  const spineItemIds = new Set<string>()
  for (const block of section.blocks) {
    if (block.spineItemId) spineItemIds.add(block.spineItemId)
  }
  if (spineItemIds.size === 0) return []
  return spineEntries.filter((s) => spineItemIds.has(s.idref))
}

type DocCache = Map<string, Document>

async function loadXhtml(zip: JSZip, path: string, cache: DocCache): Promise<Document | null> {
  const cached = cache.get(path)
  if (cached) return cached
  const xhtml = await readString(zip, path)
  if (!xhtml) return null
  let doc: Document
  try {
    doc = parseXml(xhtml, 'application/xhtml+xml')
  } catch {
    try {
      doc = getDomParser().parseFromString(xhtml, 'text/html')
    } catch {
      return null
    }
  }
  cache.set(path, doc)
  return doc
}

function injectStylesheetLink(doc: Document, hrefFromXhtml: string): void {
  const head = doc.getElementsByTagName('head')[0]
  if (!head) return
  const existing = Array.from(head.getElementsByTagName('link')).find(
    (l) => l.getAttribute('href') === hrefFromXhtml,
  )
  if (existing) return
  const link = doc.createElement('link')
  link.setAttribute('rel', 'stylesheet')
  link.setAttribute('type', 'text/css')
  link.setAttribute('href', hrefFromXhtml)
  head.appendChild(link)
}

function relativeStylePath(spineHref: string, cssHref: string): string {
  const spineParts = spineHref.split('/').slice(0, -1)
  const cssParts = cssHref.split('/')
  let i = 0
  while (i < spineParts.length && i < cssParts.length && spineParts[i] === cssParts[i]) i += 1
  const upCount = spineParts.length - i
  const ups = upCount > 0 ? '../'.repeat(upCount) : ''
  const rest = cssParts.slice(i).join('/')
  return `${ups}${rest}`
}

function replaceBodyWithBracket(doc: Document, bracketText: string): void {
  const body = doc.body ?? doc.getElementsByTagName('body')[0]
  if (!body) return
  while (body.firstChild) body.removeChild(body.firstChild)
  const aside = createBracketAside(doc, bracketText, 'macro')
  body.appendChild(aside)
}

function replaceBodyWithEmptyComment(doc: Document): void {
  const body = doc.body ?? doc.getElementsByTagName('body')[0]
  if (!body) return
  while (body.firstChild) body.removeChild(body.firstChild)
  const comment = doc.createComment(' abridged into preceding section ')
  body.appendChild(comment)
}

function findContainerForBlockIds(
  doc: Document,
  blockIds: string[],
  blockById: Map<string, Block>,
): { startEl: Element; endEl: Element; parent: Element } | null {
  const elements: Element[] = []
  for (const bid of blockIds) {
    const block = blockById.get(bid)
    if (!block?.domPath) continue
    const el = findElementByDomPath(doc, block.domPath)
    if (el) elements.push(el)
  }
  if (elements.length === 0) return null
  const startEl = elements[0]
  const endEl = elements[elements.length - 1]
  const parent = startEl.parentElement
  if (!parent) return null
  return { startEl, endEl, parent }
}

function replaceRangeWithMicroBracket(
  doc: Document,
  blockIds: string[],
  blockById: Map<string, Block>,
  bracketText: string,
): boolean {
  const range = findContainerForBlockIds(doc, blockIds, blockById)
  if (!range) return false
  const aside = createBracketAside(doc, bracketText, 'micro')
  const { startEl, endEl, parent } = range
  if (startEl.parentElement !== parent || endEl.parentElement !== parent) {
    parent.replaceChild(aside, startEl)
    for (const bid of blockIds.slice(1)) {
      const block = blockById.get(bid)
      if (!block?.domPath) continue
      const el = findElementByDomPath(doc, block.domPath)
      if (el?.parentElement) el.parentElement.removeChild(el)
    }
    return true
  }
  parent.insertBefore(aside, startEl)
  const children = Array.from(parent.children)
  const startIdx = children.indexOf(startEl)
  const endIdx = children.indexOf(endEl)
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    if (startEl.parentElement === parent) parent.removeChild(startEl)
    return true
  }
  for (let i = startIdx; i <= endIdx; i += 1) {
    const child = children[i]
    if (child.parentElement === parent) parent.removeChild(child)
  }
  return true
}

function ensureMetadataStylesheetEntry(opf: OpfData, cssManifestId: string, cssHref: string): void {
  const existing = Array.from(opf.manifestEntries.values()).find(
    (e) => e.href === cssHref || e.id === cssManifestId,
  )
  if (existing) return
  const item = opf.doc.createElementNS(NAMESPACE.opf, 'item')
  item.setAttribute('id', cssManifestId)
  item.setAttribute('href', cssHref)
  item.setAttribute('media-type', 'text/css')
  opf.manifestEl.appendChild(item)
  opf.manifestEntries.set(cssManifestId, { id: cssManifestId, href: cssHref, mediaType: 'text/css' })
}

type SectionWork = {
  section: Section
  macro?: MacroDecision
  micro?: MicroDecision
  spineEntries: SpineEntry[]
  blockById: Map<string, Block>
}

type BracketJob =
  | {
      kind: 'macro'
      work: SectionWork
    }
  | {
      kind: 'micro'
      work: SectionWork
      deletionIndex: number
    }

function buildSectionWork(
  sections: Section[],
  macroDecisions: MacroDecision[],
  microDecisions: MicroDecision[],
  spineEntries: SpineEntry[],
): SectionWork[] {
  const macroById = new Map(macroDecisions.map((m) => [m.sectionId, m] as const))
  const microById = new Map(microDecisions.map((m) => [m.sectionId, m] as const))
  return sections.map((section) => {
    const blockById = new Map<string, Block>()
    for (const b of section.blocks) blockById.set(b.id, b)
    return {
      section,
      macro: macroById.get(section.id),
      micro: microById.get(section.id),
      spineEntries: spineItemsForSection(section, spineEntries),
      blockById,
    }
  })
}

function offsetOfBlockInSection(section: Section, blockId: string): number {
  let offset = 0
  for (const b of section.blocks) {
    if (b.classification === 'header' || b.classification === 'folio' || b.classification === 'footer') continue
    if (b.id === blockId) return offset
    if (offset > 0) offset += 2 // for "\n\n"
    else offset = 0
    offset += b.text.length
  }
  return 0
}

function deletedTextForMicro(section: Section, deletionBlockIds: string[]): string {
  const out: string[] = []
  for (const b of section.blocks) {
    if (deletionBlockIds.includes(b.id)) out.push(b.text)
  }
  return out.join('\n\n')
}

function buildBracketJobs(work: SectionWork[]): BracketJob[] {
  const jobs: BracketJob[] = []
  for (const w of work) {
    if (!w.macro) continue
    if (w.macro.verdict === 'COMPRESS_TO_BRACKET' || w.macro.verdict === 'DROP_TO_ONE_LINE') {
      jobs.push({ kind: 'macro', work: w })
      continue
    }
    if (!w.micro) continue
    w.micro.deletions.forEach((_d, i) => {
      jobs.push({ kind: 'micro', work: w, deletionIndex: i })
    })
  }
  return jobs
}

async function runBracketJobs(
  jobs: BracketJob[],
  input: ReconstructEpubInput,
  concurrency: number,
  signal?: AbortSignal,
): Promise<ReconstructedBracket[]> {
  return mapWithLimit(jobs, concurrency, async (job) => {
    if (signal?.aborted) {
      return {
        sectionId: job.work.section.id,
        deletionIndex: job.kind === 'macro' ? -1 : job.deletionIndex,
        bracketText: '[aborted]',
      }
    }
    if (job.kind === 'macro') {
      const section = job.work.section
      const targetLength = job.work.macro?.bracketLengthHint ?? (job.work.macro?.verdict === 'DROP_TO_ONE_LINE' ? 'one-line' : 'short')
      const result = await writeBracket(
        {
          scope: 'macro',
          deletedText: section.rawText,
          precedingContext: '',
          followingContext: '',
          targetLength,
          spine: input.ctx.spine,
          voiceSample: section.voiceSample ?? input.ctx.spine.voiceAnchors[0] ?? '',
          purpose: input.ctx.purpose,
        },
        input.client,
        { signal, metadata: { requestId: `bracket-macro-${section.id}` } },
      )
      return { sectionId: section.id, deletionIndex: -1, bracketText: result.text }
    }
    const section = job.work.section
    const deletion = job.work.micro!.deletions[job.deletionIndex]
    const firstBlockId = deletion.containedBlockIds[0]
    const startOffset = firstBlockId ? offsetOfBlockInSection(section, firstBlockId) : deletion.startOffset
    const deleted = deletedTextForMicro(section, deletion.containedBlockIds)
    const result = await writeBracket(
      {
        scope: 'micro',
        deletedText: deleted || section.rawText.slice(deletion.startOffset, deletion.endOffset),
        precedingContext: getPrecedingContext(section, startOffset, 1),
        followingContext: getFollowingContext(section, startOffset + deleted.length, 1),
        targetLength: deletion.bracketLengthHint,
        spine: input.ctx.spine,
        voiceSample: section.voiceSample ?? input.ctx.spine.voiceAnchors[0] ?? '',
        purpose: input.ctx.purpose,
      },
      input.client,
      { signal, metadata: { requestId: `bracket-micro-${section.id}-${job.deletionIndex}` } },
    )
    return {
      sectionId: section.id,
      deletionIndex: job.deletionIndex,
      bracketText: result.text,
    }
  })
}

function bracketsForJob(
  brackets: ReconstructedBracket[],
  sectionId: string,
  deletionIndex: number,
): ReconstructedBracket | undefined {
  return brackets.find((b) => b.sectionId === sectionId && b.deletionIndex === deletionIndex)
}

export type AbridgedSegment = { kind: 'kept' | 'bracket'; text: string }

export type BuildAbridgedEpubInput = {
  originalBlob: Blob
  parsedBook: ParsedBook
  segments: AbridgedSegment[]
}

export type BuildAbridgedEpubOutput = {
  abridgedBlob: Blob
  stats: {
    originalPages: number
    abridgedPages: number
    bracketCount: number
  }
}

const BRACKET_SENTINEL_PATTERN = /<<<BR>>>([\s\S]*?)<<<\/BR>>>/g

export function parseAbridgedSegments(abridged: string): AbridgedSegment[] {
  const segments: AbridgedSegment[] = []
  let cursor = 0
  const text = abridged
  BRACKET_SENTINEL_PATTERN.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = BRACKET_SENTINEL_PATTERN.exec(text)) !== null) {
    const matchStart = match.index
    const matchEnd = matchStart + match[0].length
    if (matchStart > cursor) {
      const before = text.slice(cursor, matchStart).trim()
      if (before.length > 0) segments.push({ kind: 'kept', text: before })
    }
    const inner = match[1].trim()
    if (inner.length > 0) segments.push({ kind: 'bracket', text: inner })
    cursor = matchEnd
  }
  if (cursor < text.length) {
    const tail = text.slice(cursor).trim()
    if (tail.length > 0) segments.push({ kind: 'kept', text: tail })
  }
  if (segments.length === 0 && text.trim().length > 0) {
    segments.push({ kind: 'kept', text: text.trim() })
  }
  return segments
}

function splitParagraphs(text: string): string[] {
  return text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
}

function appendSegmentsToBody(doc: Document, body: Element, segments: AbridgedSegment[], title: string): void {
  const heading = doc.createElement('h1')
  heading.textContent = title
  body.appendChild(heading)
  for (const seg of segments) {
    const paragraphs = splitParagraphs(seg.text)
    if (paragraphs.length === 0) continue
    if (seg.kind === 'bracket') {
      const aside = doc.createElement('aside')
      aside.setAttribute('class', 'abridger-bracket abridger-bracket--macro')
      aside.setAttribute('role', 'note')
      for (const p of paragraphs) {
        const para = doc.createElement('p')
        para.textContent = p
        aside.appendChild(para)
      }
      body.appendChild(aside)
    } else {
      for (const p of paragraphs) {
        const para = doc.createElement('p')
        para.textContent = p
        body.appendChild(para)
      }
    }
  }
}

function replaceBodyWithSegments(doc: Document, segments: AbridgedSegment[], title: string): void {
  const body = doc.body ?? doc.getElementsByTagName('body')[0]
  if (!body) return
  while (body.firstChild) body.removeChild(body.firstChild)
  appendSegmentsToBody(doc, body, segments, title)
}

export async function buildAbridgedEpubFromText(
  input: BuildAbridgedEpubInput,
): Promise<BuildAbridgedEpubOutput> {
  if (input.parsedBook.format !== 'epub') {
    throw new Error('buildAbridgedEpubFromText: parsedBook.format must be "epub".')
  }
  const arrayBuffer = await blobToArrayBuffer(input.originalBlob)
  const zip = await JSZip.loadAsync(arrayBuffer)

  const opfPath = await findOpfPath(zip)
  const opf = await readOpf(zip, opfPath)
  const spineEntries = buildSpineEntries(opf, opfPath)
  const originalSpineCount = spineEntries.length
  if (spineEntries.length === 0) {
    throw new Error('buildAbridgedEpubFromText: EPUB spine is empty.')
  }

  const cssHref = 'abridger.css'
  const opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/')) : ''
  const cssZipPath = opfDir ? `${opfDir}/${cssHref}` : cssHref
  ensureMetadataStylesheetEntry(opf, 'abridger-css', cssHref)
  zip.file(cssZipPath, ABRIDGER_CSS)

  const segments = input.segments
  const bracketCount = segments.filter((s) => s.kind === 'bracket').length
  const title = input.parsedBook.title?.trim() || 'Abridged'

  const docCache: DocCache = new Map()
  const serializer = getXmlSerializer()
  for (let i = 0; i < spineEntries.length; i += 1) {
    const entry = spineEntries[i]
    const doc = await loadXhtml(zip, entry.path, docCache)
    if (!doc) continue
    if (i === 0) {
      replaceBodyWithSegments(doc, segments, title)
      injectStylesheetLink(doc, relativeStylePath(entry.href, cssHref))
    } else {
      replaceBodyWithEmptyComment(doc)
    }
  }
  for (const [path, doc] of docCache.entries()) {
    const serialized = serializer.serializeToString(doc)
    zip.file(path, serialized)
  }

  const newOpfXml = serializer.serializeToString(opf.doc)
  zip.file(opfPath, newOpfXml)

  const abridgedBlob = await zip.generateAsync({ type: 'blob', mimeType: 'application/epub+zip' })

  return {
    abridgedBlob,
    stats: {
      originalPages: originalSpineCount,
      abridgedPages: 1,
      bracketCount,
    },
  }
}

export async function reconstructEpub(
  input: ReconstructEpubInput,
  opts: ReconstructEpubOptions = {},
): Promise<ReconstructEpubOutput> {
  const start = Date.now()
  const emit = opts.emit
  emit?.({ kind: 'phase-start', phase: PHASE_NAME })

  if (input.parsedBook.format !== 'epub') {
    throw new Error('reconstructEpub: parsedBook.format must be "epub".')
  }

  const concurrency = opts.bracketConcurrency ?? DEFAULT_BRACKET_CONCURRENCY
  const arrayBuffer = await blobToArrayBuffer(input.originalBlob)
  const zip = await JSZip.loadAsync(arrayBuffer)

  const opfPath = await findOpfPath(zip)
  const opf = await readOpf(zip, opfPath)
  const spineEntries = buildSpineEntries(opf, opfPath)
  const originalSpineCount = spineEntries.length

  const work = buildSectionWork(input.sections, input.macroDecisions, input.microDecisions, spineEntries)
  const jobs = buildBracketJobs(work)
  const brackets = await runBracketJobs(jobs, input, concurrency, opts.signal)

  emit?.({
    kind: 'phase-progress',
    phase: PHASE_NAME,
    completed: brackets.length,
    total: jobs.length,
  })

  const cssHref = 'abridger.css'
  const opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/')) : ''
  const cssZipPath = opfDir ? `${opfDir}/${cssHref}` : cssHref
  ensureMetadataStylesheetEntry(opf, 'abridger-css', cssHref)
  zip.file(cssZipPath, ABRIDGER_CSS)

  const docCache: DocCache = new Map()
  let sectionsKept = 0
  let sectionsBracketed = 0
  let microCutsCount = 0

  for (const w of work) {
    if (!w.macro) {
      sectionsKept += 1
      continue
    }
    if (w.macro.verdict === 'COMPRESS_TO_BRACKET' || w.macro.verdict === 'DROP_TO_ONE_LINE') {
      sectionsBracketed += 1
      const bracket = bracketsForJob(brackets, w.section.id, -1)
      if (!bracket) continue
      const entries = w.spineEntries
      for (let i = 0; i < entries.length; i += 1) {
        const entry = entries[i]
        const doc = await loadXhtml(zip, entry.path, docCache)
        if (!doc) continue
        if (i === 0) {
          replaceBodyWithBracket(doc, bracket.bracketText)
        } else {
          replaceBodyWithEmptyComment(doc)
        }
      }
    } else {
      sectionsKept += 1
      if (!w.micro || w.micro.deletions.length === 0) continue
      const firstEntry = w.spineEntries[0]
      if (!firstEntry) continue
      const doc = await loadXhtml(zip, firstEntry.path, docCache)
      if (!doc) continue
      w.micro.deletions.forEach((deletion, i) => {
        const bracket = bracketsForJob(brackets, w.section.id, i)
        if (!bracket) return
        const applied = replaceRangeWithMicroBracket(doc, deletion.containedBlockIds, w.blockById, bracket.bracketText)
        if (applied) microCutsCount += 1
      })
    }
  }

  const serializer = getXmlSerializer()
  for (const [path, doc] of docCache.entries()) {
    const entry = spineEntries.find((s) => s.path === path)
    if (entry) {
      const relCss = relativeStylePath(entry.href, cssHref)
      injectStylesheetLink(doc, relCss)
    }
    const serialized = serializer.serializeToString(doc)
    zip.file(path, serialized)
  }

  const newOpfXml = serializer.serializeToString(opf.doc)
  zip.file(opfPath, newOpfXml)

  const abridgedBlob = await zip.generateAsync({ type: 'blob', mimeType: 'application/epub+zip' })

  emit?.({ kind: 'phase-end', phase: PHASE_NAME, durationMs: Date.now() - start })

  return {
    abridgedBlob,
    bracketTexts: brackets,
    stats: {
      originalPages: originalSpineCount,
      abridgedPages: originalSpineCount - work.filter(
        (w) => w.macro?.verdict === 'COMPRESS_TO_BRACKET' || w.macro?.verdict === 'DROP_TO_ONE_LINE',
      ).reduce((acc, w) => acc + Math.max(0, w.spineEntries.length - 1), 0),
      sectionsKept,
      sectionsBracketed,
      microCuts: microCutsCount,
    },
  }
}
