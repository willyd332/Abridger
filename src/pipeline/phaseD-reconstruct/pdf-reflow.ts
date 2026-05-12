import { createElement, type ReactNode } from 'react'
import {
  Document,
  Font,
  Page,
  StyleSheet,
  Text,
  View,
  pdf,
} from '@react-pdf/renderer'

import { mapWithLimit } from '@/lib/concurrency'
import { LLMClient } from '@/llm/client'
import type { Block, ParsedBook } from '@/parsers/types'

import { getFollowingContext, getPrecedingContext } from '../bracket-helpers'
import { writeBracket } from '../bracket-writer'
import type {
  BookContext,
  Emit,
  MacroDecision,
  MicroDecision,
  Section,
} from '../types'

const PHASE_NAME = 'D-pdf'
const DEFAULT_BRACKET_CONCURRENCY = 3
const WHOLE_SECTION_DELETION_INDEX = -1
const FONT_FAMILY = 'EB Garamond'
const FALLBACK_FONT_FAMILY = 'Times-Roman'

// ----- Font registration (best-effort) -----------------------------------------
// EB Garamond ships only WOFF/WOFF2 in the Fontsource package. fontkit (used by
// @react-pdf/renderer) supports WOFF2, so we serve the woff2 files from
// public/fonts/. Registration is best-effort: jsdom-based tests can't fetch the
// public asset, so we silently fall back to Times-Roman (a PDF standard font).
let fontRegistrationAttempted = false
function registerFonts(): string {
  if (fontRegistrationAttempted) {
    return FONT_FAMILY
  }
  fontRegistrationAttempted = true
  try {
    const base =
      typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.BASE_URL
        ? import.meta.env.BASE_URL
        : '/'
    const normalized = base.endsWith('/') ? base : `${base}/`
    Font.register({
      family: FONT_FAMILY,
      fonts: [
        { src: `${normalized}fonts/eb-garamond-regular.woff2`, fontWeight: 400 },
        {
          src: `${normalized}fonts/eb-garamond-italic.woff2`,
          fontStyle: 'italic',
          fontWeight: 400,
        },
        { src: `${normalized}fonts/eb-garamond-bold.woff2`, fontWeight: 700 },
      ],
    })
    return FONT_FAMILY
  } catch (err) {
    console.warn('reconstructPdf: font registration failed; falling back to Times-Roman.', err)
    return FALLBACK_FONT_FAMILY
  }
}

// Skip running Font.register inside jsdom — fetch of /Abridger/fonts/* will fail
// at render time and throw with no useful info. Detect by checking whether
// fetch can reach the asset URL; simpler: check for jsdom user-agent.
function shouldRegisterFonts(): boolean {
  if (typeof navigator === 'undefined') return true
  const ua = navigator.userAgent ?? ''
  if (ua.toLowerCase().includes('jsdom')) return false
  return true
}

// ----- Styling ----------------------------------------------------------------
const PARCHMENT_TINT = '#f4e8d0'
const MARGINALIA_INK = '#7a6a4f'

function makeStyles(fontFamily: string) {
  return StyleSheet.create({
    page: {
      paddingTop: 85,
      paddingBottom: 85,
      paddingLeft: 70,
      paddingRight: 70,
      fontFamily,
      fontSize: 11,
      lineHeight: 1.5,
      color: '#1a1a1a',
    },
    cover: {
      paddingTop: 140,
      paddingBottom: 85,
      paddingLeft: 70,
      paddingRight: 70,
      fontFamily,
      color: '#1a1a1a',
    },
    coverTitle: { fontSize: 28, fontWeight: 700, marginBottom: 12 },
    coverAuthor: { fontSize: 16, marginBottom: 32 },
    coverPurposeLabel: { fontSize: 11, marginBottom: 4, color: '#555' },
    coverPurpose: { fontSize: 13, fontStyle: 'italic', marginBottom: 48 },
    coverFooter: { fontSize: 10, color: '#555', position: 'absolute', bottom: 60, left: 70, right: 70 },
    sectionHeading: {
      fontSize: 16,
      fontWeight: 700,
      marginTop: 12,
      marginBottom: 12,
    },
    subheading: { fontSize: 13, fontWeight: 700, marginTop: 10, marginBottom: 8 },
    bodyParagraph: { marginBottom: 8, textAlign: 'justify' },
    protectedParagraph: { marginBottom: 8, fontFamily: 'Courier', fontSize: 10 },
    bracket: {
      backgroundColor: PARCHMENT_TINT,
      marginVertical: 10,
      marginLeft: 22,
      marginRight: 22,
      padding: 10,
      fontSize: 10.5,
      fontStyle: 'italic',
      lineHeight: 1.45,
      borderLeft: 2,
      borderLeftColor: '#b8860b',
      borderLeftStyle: 'solid',
    },
    bracketMacro: { marginVertical: 14 },
    footnoteHeader: {
      fontSize: 10,
      fontWeight: 700,
      marginTop: 16,
      marginBottom: 6,
      color: '#444',
    },
    footnote: {
      fontSize: 9,
      lineHeight: 1.35,
      marginBottom: 4,
      color: '#333',
    },
    marginalia: {
      fontSize: 8,
      fontStyle: 'italic',
      color: MARGINALIA_INK,
      textAlign: 'right',
      marginBottom: 6,
    },
  })
}

type Styles = ReturnType<typeof makeStyles>

// ----- Bracket job planning ---------------------------------------------------
type SectionWork = {
  section: Section
  macro?: MacroDecision
  micro?: MicroDecision
}

type BracketJob =
  | { kind: 'macro'; work: SectionWork }
  | { kind: 'micro'; work: SectionWork; deletionIndex: number }

function indexBy<T, K extends string>(items: T[], key: (item: T) => K): Map<K, T> {
  return items.reduce((acc, item) => {
    const next = new Map(acc)
    next.set(key(item), item)
    return next
  }, new Map<K, T>())
}

function buildSectionWork(
  sections: Section[],
  macroDecisions: MacroDecision[],
  microDecisions: MicroDecision[],
): SectionWork[] {
  const macroById = indexBy(macroDecisions, (m) => m.sectionId)
  const microById = indexBy(microDecisions, (m) => m.sectionId)
  return sections.map((section) => ({
    section,
    macro: macroById.get(section.id),
    micro: microById.get(section.id),
  }))
}

function buildBracketJobs(work: SectionWork[]): BracketJob[] {
  return work.reduce<BracketJob[]>((acc, w) => {
    if (!w.macro) return acc
    if (w.macro.verdict === 'COMPRESS_TO_BRACKET' || w.macro.verdict === 'DROP_TO_ONE_LINE') {
      return [...acc, { kind: 'macro', work: w }]
    }
    if (!w.micro) return acc
    return w.micro.deletions.reduce<BracketJob[]>(
      (inner, _d, i) => [...inner, { kind: 'micro', work: w, deletionIndex: i }],
      acc,
    )
  }, [])
}

function offsetOfBlockInSection(section: Section, blockId: string): number {
  let offset = 0
  let started = false
  for (const b of section.blocks) {
    if (
      b.classification === 'header' ||
      b.classification === 'folio' ||
      b.classification === 'footer'
    ) {
      continue
    }
    if (b.id === blockId) return offset
    if (started) offset += 2 // joining '\n\n'
    offset += b.text.length
    started = true
  }
  return 0
}

function deletedTextForMicro(section: Section, blockIds: string[]): string {
  const ids = new Set(blockIds)
  return section.blocks
    .filter((b) => ids.has(b.id))
    .map((b) => b.text)
    .join('\n\n')
}

export type ReconstructedBracket = {
  sectionId: string
  deletionIndex: number
  bracketText: string
}

async function runBracketJobs(
  jobs: BracketJob[],
  input: ReconstructPdfInput,
  concurrency: number,
  signal?: AbortSignal,
): Promise<ReconstructedBracket[]> {
  return mapWithLimit(jobs, concurrency, async (job) => {
    if (signal?.aborted) {
      return {
        sectionId: job.work.section.id,
        deletionIndex: job.kind === 'macro' ? WHOLE_SECTION_DELETION_INDEX : job.deletionIndex,
        bracketText: '[aborted]',
      }
    }
    if (job.kind === 'macro') {
      const section = job.work.section
      const macro = job.work.macro!
      const targetLength =
        macro.bracketLengthHint ?? (macro.verdict === 'DROP_TO_ONE_LINE' ? 'one-line' : 'short')
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
        { signal, metadata: { requestId: `pdf-bracket-macro-${section.id}` } },
      )
      return {
        sectionId: section.id,
        deletionIndex: WHOLE_SECTION_DELETION_INDEX,
        bracketText: result.text,
      }
    }
    const section = job.work.section
    const deletion = job.work.micro!.deletions[job.deletionIndex]
    const firstBlockId = deletion.containedBlockIds[0]
    const startOffset = firstBlockId
      ? offsetOfBlockInSection(section, firstBlockId)
      : deletion.startOffset
    const deletedText =
      deletedTextForMicro(section, deletion.containedBlockIds) ||
      section.rawText.slice(deletion.startOffset, deletion.endOffset)
    const result = await writeBracket(
      {
        scope: 'micro',
        deletedText,
        precedingContext: getPrecedingContext(section, startOffset, 1),
        followingContext: getFollowingContext(section, startOffset + deletedText.length, 1),
        targetLength: deletion.bracketLengthHint,
        spine: input.ctx.spine,
        voiceSample: section.voiceSample ?? input.ctx.spine.voiceAnchors[0] ?? '',
        purpose: input.ctx.purpose,
      },
      input.client,
      {
        signal,
        metadata: { requestId: `pdf-bracket-micro-${section.id}-${job.deletionIndex}` },
      },
    )
    return {
      sectionId: section.id,
      deletionIndex: job.deletionIndex,
      bracketText: result.text,
    }
  })
}

// ----- Rendering helpers ------------------------------------------------------
function formatToday(date: Date = new Date()): string {
  const yyyy = date.getUTCFullYear()
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(date.getUTCDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function pageRangeForBlocks(blocks: Block[]): { firstPage: number; lastPage: number } | null {
  const pageNumbers = blocks
    .map((b) => b.pageNumber)
    .filter((n) => Number.isFinite(n) && n > 0)
  if (pageNumbers.length === 0) return null
  return {
    firstPage: Math.min(...pageNumbers),
    lastPage: Math.max(...pageNumbers),
  }
}

type RenderableBlock =
  | { kind: 'body'; block: Block }
  | { kind: 'protected'; block: Block }
  | { kind: 'caption'; block: Block }
  | { kind: 'footnote'; block: Block }
  | { kind: 'bracket'; bracketText: string; deletionIndex: number }

function planSectionBlocks(
  section: Section,
  micro: MicroDecision | undefined,
  brackets: ReconstructedBracket[],
): RenderableBlock[] {
  const bodyEligible = section.blocks.filter(
    (b) =>
      b.classification !== 'header' &&
      b.classification !== 'footer' &&
      b.classification !== 'folio',
  )
  const deletions = micro?.deletions ?? []
  const deletedIdToIndex = new Map<string, number>()
  deletions.forEach((d, idx) => {
    for (const bid of d.containedBlockIds) deletedIdToIndex.set(bid, idx)
  })

  const out: RenderableBlock[] = []
  const seenBracketIndices = new Set<number>()

  for (const block of bodyEligible) {
    if (block.classification === 'footnote') {
      // Footnotes are emitted at the end of the section.
      continue
    }
    const deletionIdx = deletedIdToIndex.get(block.id)
    if (deletionIdx !== undefined) {
      if (!seenBracketIndices.has(deletionIdx)) {
        const bracket = brackets.find(
          (b) => b.sectionId === section.id && b.deletionIndex === deletionIdx,
        )
        if (bracket) {
          out.push({
            kind: 'bracket',
            bracketText: bracket.bracketText,
            deletionIndex: deletionIdx,
          })
        }
        seenBracketIndices.add(deletionIdx)
      }
      continue
    }
    if (block.classification === 'protected') {
      out.push({ kind: 'protected', block })
    } else if (block.classification === 'caption') {
      out.push({ kind: 'caption', block })
    } else {
      out.push({ kind: 'body', block })
    }
  }

  // Append footnotes at the end.
  const footnotes = bodyEligible.filter((b) => b.classification === 'footnote')
  for (const fn of footnotes) {
    out.push({ kind: 'footnote', block: fn })
  }
  return out
}

// ----- React-PDF tree -----------------------------------------------------------
type RenderInput = {
  parsedBook: ParsedBook
  sections: Section[]
  work: SectionWork[]
  brackets: ReconstructedBracket[]
  ctx: BookContext
  fontFamily: string
  generatedDate: string
}

function renderMarginalia(styles: Styles, label: string): ReactNode {
  return createElement(Text, { style: styles.marginalia, key: `marg-${label}` }, label)
}

function renderBracket(
  styles: Styles,
  bracketText: string,
  key: string,
  scope: 'macro' | 'micro',
): ReactNode {
  const style = scope === 'macro' ? [styles.bracket, styles.bracketMacro] : styles.bracket
  return createElement(
    View,
    { style, key },
    createElement(Text, null, `[ ${bracketText} ]`),
  )
}

function renderSectionContent(
  styles: Styles,
  section: Section,
  macro: MacroDecision | undefined,
  micro: MicroDecision | undefined,
  brackets: ReconstructedBracket[],
): ReactNode[] {
  const nodes: ReactNode[] = []
  // Heading
  nodes.push(
    createElement(
      Text,
      { style: styles.sectionHeading, key: `head-${section.id}` },
      section.title,
    ),
  )
  // Page-range marginalia at section start
  const pages = pageRangeForBlocks(section.blocks)
  if (pages) {
    const label =
      pages.firstPage === pages.lastPage
        ? `[orig. p. ${pages.firstPage}]`
        : `[orig. pp. ${pages.firstPage}–${pages.lastPage}]`
    nodes.push(renderMarginalia(styles, label))
  }

  if (!macro || macro.verdict === 'KEEP_FULL' || macro.verdict === 'KEEP_PARTIAL') {
    const plan = planSectionBlocks(section, micro, brackets)
    let bodyParagraphIndex = 0
    let footnoteHeaderInserted = false
    for (let i = 0; i < plan.length; i += 1) {
      const item = plan[i]
      if (item.kind === 'bracket') {
        nodes.push(
          renderBracket(
            styles,
            item.bracketText,
            `bracket-${section.id}-${item.deletionIndex}`,
            'micro',
          ),
        )
      } else if (item.kind === 'protected') {
        nodes.push(
          createElement(
            Text,
            { style: styles.protectedParagraph, key: `prot-${section.id}-${i}` },
            item.block.text,
          ),
        )
      } else if (item.kind === 'caption') {
        nodes.push(
          createElement(
            Text,
            { style: styles.bodyParagraph, key: `cap-${section.id}-${i}` },
            item.block.text,
          ),
        )
      } else if (item.kind === 'footnote') {
        if (!footnoteHeaderInserted) {
          nodes.push(
            createElement(
              Text,
              { style: styles.footnoteHeader, key: `fn-head-${section.id}` },
              'Notes',
            ),
          )
          footnoteHeaderInserted = true
        }
        nodes.push(
          createElement(
            Text,
            { style: styles.footnote, key: `fn-${section.id}-${i}` },
            item.block.text,
          ),
        )
      } else {
        bodyParagraphIndex += 1
        nodes.push(
          createElement(
            Text,
            { style: styles.bodyParagraph, key: `body-${section.id}-${bodyParagraphIndex}` },
            item.block.text,
          ),
        )
      }
    }
    return nodes
  }

  // COMPRESS_TO_BRACKET or DROP_TO_ONE_LINE: one macro bracket
  const macroBracket = brackets.find(
    (b) => b.sectionId === section.id && b.deletionIndex === WHOLE_SECTION_DELETION_INDEX,
  )
  if (macroBracket) {
    nodes.push(renderBracket(styles, macroBracket.bracketText, `macro-${section.id}`, 'macro'))
  }
  return nodes
}

function renderDocument(input: RenderInput): ReactNode {
  const styles = makeStyles(input.fontFamily)
  const title = (input.parsedBook.title ?? '').trim() || 'Abridged Book'
  const author = (input.parsedBook.author ?? '').trim()
  const generated = input.generatedDate

  // Cover page
  const coverChildren: ReactNode[] = [
    createElement(Text, { style: styles.coverTitle, key: 'cover-title' }, title),
  ]
  if (author) {
    coverChildren.push(createElement(Text, { style: styles.coverAuthor, key: 'cover-author' }, author))
  }
  coverChildren.push(
    createElement(Text, { style: styles.coverPurposeLabel, key: 'cover-pl' }, 'Reading purpose'),
  )
  coverChildren.push(
    createElement(Text, { style: styles.coverPurpose, key: 'cover-p' }, input.ctx.purpose),
  )
  coverChildren.push(
    createElement(
      Text,
      { style: styles.coverFooter, key: 'cover-foot' },
      `Abridged by The Abridger on ${generated}`,
    ),
  )
  const coverPage = createElement(
    Page,
    { size: 'A4', style: styles.cover, key: 'cover-page' },
    ...coverChildren,
  )

  // Body pages: a single wrap-enabled Page per section gives react-pdf room to
  // re-flow content across as many physical pages as needed.
  const ordered = [...input.sections].sort((a, b) => a.order - b.order)
  const bodyPages = ordered.map((section) => {
    const work = input.work.find((w) => w.section.id === section.id)
    const sectionNodes = renderSectionContent(
      styles,
      section,
      work?.macro,
      work?.micro,
      input.brackets,
    )
    return createElement(
      Page,
      { size: 'A4', style: styles.page, wrap: true, key: `page-${section.id}` },
      createElement(View, { key: `wrap-${section.id}` }, ...sectionNodes),
    )
  })

  return createElement(
    Document,
    {
      title,
      author: author || undefined,
      creator: 'The Abridger',
      producer: 'The Abridger',
    },
    coverPage,
    ...bodyPages,
  )
}

// ----- Public API --------------------------------------------------------------
export type ReconstructPdfInput = {
  parsedBook: ParsedBook
  sections: Section[]
  macroDecisions: MacroDecision[]
  microDecisions: MicroDecision[]
  ctx: BookContext
  client: LLMClient
}

export type ReconstructPdfStats = {
  originalPages: number
  abridgedPages: number
  sectionsKept: number
  sectionsBracketed: number
  microCuts: number
}

export type ReconstructPdfOutput = {
  abridgedBlob: Blob
  bracketTexts: ReconstructedBracket[]
  stats: ReconstructPdfStats
}

export type ReconstructPdfOptions = {
  emit?: Emit
  signal?: AbortSignal
  bracketConcurrency?: number
}

async function readBlobAsArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
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

async function blobPageCount(blob: Blob): Promise<number> {
  // The PDF page count is needed for stats. Count by walking the blob bytes for
  // "/Type /Page" entries (excluding "/Type /Pages"). pdf-lib would also work
  // but adds a hard dep; this lightweight approach is enough for stats.
  try {
    const buffer = await readBlobAsArrayBuffer(blob)
    const view = new Uint8Array(buffer)
    // Decode as latin1 — page tags are ASCII.
    let text = ''
    const chunkSize = 65536
    for (let i = 0; i < view.length; i += chunkSize) {
      const chunk = view.subarray(i, Math.min(view.length, i + chunkSize))
      text += String.fromCharCode(...chunk)
    }
    const matches = text.match(/\/Type\s*\/Page(?!s)/g)
    return matches ? matches.length : 0
  } catch {
    return 0
  }
}

export async function reconstructPdf(
  input: ReconstructPdfInput,
  opts: ReconstructPdfOptions = {},
): Promise<ReconstructPdfOutput> {
  const start = Date.now()
  const emit = opts.emit
  emit?.({ kind: 'phase-start', phase: PHASE_NAME })

  if (input.parsedBook.format !== 'pdf') {
    throw new Error('reconstructPdf: parsedBook.format must be "pdf".')
  }

  const concurrency = opts.bracketConcurrency ?? DEFAULT_BRACKET_CONCURRENCY
  const work = buildSectionWork(input.sections, input.macroDecisions, input.microDecisions)
  const jobs = buildBracketJobs(work)

  const totalSections = input.sections.length
  let completed = 0
  emit?.({
    kind: 'phase-progress',
    phase: PHASE_NAME,
    completed: 0,
    total: totalSections,
  })

  const brackets = await runBracketJobs(jobs, input, concurrency, opts.signal)

  // Per-section progress emit (after brackets are filled). This is a
  // pragmatic approximation: we emit one progress event per section as we
  // assemble its render plan.
  for (const w of work) {
    completed += 1
    emit?.({
      kind: 'phase-progress',
      phase: PHASE_NAME,
      completed,
      total: totalSections,
      sectionId: w.section.id,
    })
  }

  const fontFamily = shouldRegisterFonts() ? registerFonts() : FALLBACK_FONT_FAMILY

  const document = renderDocument({
    parsedBook: input.parsedBook,
    sections: input.sections,
    work,
    brackets,
    ctx: input.ctx,
    fontFamily,
    generatedDate: formatToday(),
  })

  const instance = pdf()
  // updateContainer accepts a React element to render. Cast the ReactNode-typed
  // element to the expected type because the typings here are loose.
  instance.updateContainer(document as Parameters<typeof instance.updateContainer>[0])
  const abridgedBlob = await instance.toBlob()

  const sectionsBracketed = work.filter(
    (w) =>
      w.macro?.verdict === 'COMPRESS_TO_BRACKET' ||
      w.macro?.verdict === 'DROP_TO_ONE_LINE',
  ).length
  const sectionsKept = work.length - sectionsBracketed
  const microCuts = work.reduce(
    (acc, w) =>
      w.macro?.verdict === 'KEEP_FULL' || w.macro?.verdict === 'KEEP_PARTIAL'
        ? acc + (w.micro?.deletions.length ?? 0)
        : acc,
    0,
  )

  const abridgedPages = await blobPageCount(abridgedBlob)
  const originalPages = input.parsedBook.pages.length

  emit?.({ kind: 'phase-end', phase: PHASE_NAME, durationMs: Date.now() - start })

  return {
    abridgedBlob,
    bracketTexts: brackets,
    stats: {
      originalPages,
      abridgedPages,
      sectionsKept,
      sectionsBracketed,
      microCuts,
    },
  }
}
