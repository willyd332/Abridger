import type { ParsedBook } from '@/parsers/types'
import type {
  CanonicalPassage,
  MacroDecision,
  MacroVerdict,
  MicroDecision,
  MicroDeletion,
  NarrativeSpine,
  Section,
} from '@/pipeline/types'

export type LedgerBracket = {
  sectionId: string
  deletionIndex: number
  bracketText: string
}

export type LedgerInput = {
  parsedBook: ParsedBook
  sections: Section[]
  macroDecisions: MacroDecision[]
  microDecisions: MicroDecision[]
  spine: NarrativeSpine
  canonicalPassages: CanonicalPassage[]
  brackets: LedgerBracket[]
  runId: string
  startedAt: number
  finishedAt: number
  modelMapping: Record<string, string>
  promptHashes: Record<string, string>
  totalCostUsd: number
  purpose: string
  originalFileName: string
}

export type LedgerStats = {
  originalLengthChars: number
  abridgedLengthChars: number
  reductionPercent: number
  sectionsKeptFull: number
  sectionsKeptPartial: number
  sectionsCompressed: number
  sectionsDropped: number
  microCutsTotal: number
  bracketsTotal: number
}

export type LedgerOutput = {
  markdown: string
  blob: Blob
  filename: string
  stats: LedgerStats
}

const PROMPT_HASH_DISPLAY_LEN = 12
const FILENAME_MAX_LEN = 80
const RUN_ID_FALLBACK_LEN = 8

const VERDICT_LABELS: Record<MacroVerdict, string> = {
  KEEP_FULL: 'KEEP FULL',
  KEEP_PARTIAL: 'KEEP PARTIAL',
  COMPRESS_TO_BRACKET: 'COMPRESS TO BRACKET',
  DROP_TO_ONE_LINE: 'DROP TO ONE LINE',
}

const WHOLE_SECTION_DELETION_INDEX = -1

export function buildLedger(input: LedgerInput): LedgerOutput {
  const decisionsById = indexById(input.macroDecisions, (d) => d.sectionId)
  const microById = indexById(input.microDecisions, (m) => m.sectionId)
  const bracketsBySection = groupBracketsBySection(input.brackets)

  const stats = computeStats({
    parsedBook: input.parsedBook,
    sections: input.sections,
    decisionsById,
    microById,
    bracketsBySection,
    bracketsTotal: input.brackets.length,
  })

  const markdown = renderMarkdown({
    input,
    decisionsById,
    microById,
    bracketsBySection,
    stats,
  })

  const blob = new Blob([markdown], { type: 'text/markdown' })
  const filename = buildFilename(input)

  return { markdown, blob, filename, stats }
}

function indexById<T>(items: T[], key: (item: T) => string): Map<string, T> {
  return items.reduce((acc, item) => {
    const next = new Map(acc)
    next.set(key(item), item)
    return next
  }, new Map<string, T>())
}

function groupBracketsBySection(brackets: LedgerBracket[]): Map<string, LedgerBracket[]> {
  return brackets.reduce((acc, bracket) => {
    const existing = acc.get(bracket.sectionId) ?? []
    const next = new Map(acc)
    next.set(bracket.sectionId, [...existing, bracket])
    return next
  }, new Map<string, LedgerBracket[]>())
}

type StatsContext = {
  parsedBook: ParsedBook
  sections: Section[]
  decisionsById: Map<string, MacroDecision>
  microById: Map<string, MicroDecision>
  bracketsBySection: Map<string, LedgerBracket[]>
  bracketsTotal: number
}

function computeStats(ctx: StatsContext): LedgerStats {
  const counts = ctx.sections.reduce(
    (acc, section) => {
      const verdict = ctx.decisionsById.get(section.id)?.verdict ?? 'KEEP_FULL'
      return {
        ...acc,
        sectionsKeptFull: acc.sectionsKeptFull + (verdict === 'KEEP_FULL' ? 1 : 0),
        sectionsKeptPartial: acc.sectionsKeptPartial + (verdict === 'KEEP_PARTIAL' ? 1 : 0),
        sectionsCompressed: acc.sectionsCompressed + (verdict === 'COMPRESS_TO_BRACKET' ? 1 : 0),
        sectionsDropped: acc.sectionsDropped + (verdict === 'DROP_TO_ONE_LINE' ? 1 : 0),
      }
    },
    {
      sectionsKeptFull: 0,
      sectionsKeptPartial: 0,
      sectionsCompressed: 0,
      sectionsDropped: 0,
    },
  )

  const microCutsTotal = ctx.sections.reduce((acc, section) => {
    const micro = ctx.microById.get(section.id)
    return acc + (micro?.deletions.length ?? 0)
  }, 0)

  const abridgedLengthChars = ctx.sections.reduce((acc, section) => {
    return acc + computeSectionAbridgedLength(section, ctx)
  }, 0)

  const originalLengthChars = ctx.parsedBook.rawText.length
  const reductionPercent =
    originalLengthChars === 0
      ? 0
      : roundTo(1 - abridgedLengthChars / originalLengthChars, 3) * 100

  return {
    originalLengthChars,
    abridgedLengthChars,
    reductionPercent: roundTo(reductionPercent, 1),
    sectionsKeptFull: counts.sectionsKeptFull,
    sectionsKeptPartial: counts.sectionsKeptPartial,
    sectionsCompressed: counts.sectionsCompressed,
    sectionsDropped: counts.sectionsDropped,
    microCutsTotal,
    bracketsTotal: ctx.bracketsTotal,
  }
}

function computeSectionAbridgedLength(section: Section, ctx: StatsContext): number {
  const decision = ctx.decisionsById.get(section.id)
  const verdict = decision?.verdict ?? 'KEEP_FULL'
  const bracketsForSection = ctx.bracketsBySection.get(section.id) ?? []

  if (verdict === 'COMPRESS_TO_BRACKET' || verdict === 'DROP_TO_ONE_LINE') {
    const wholeSectionBracket = bracketsForSection.find(
      (b) => b.deletionIndex === WHOLE_SECTION_DELETION_INDEX,
    )
    return wholeSectionBracket?.bracketText.length ?? 0
  }

  const micro = ctx.microById.get(section.id)
  const deletions: MicroDeletion[] = micro?.deletions ?? []
  const deletedChars = deletions.reduce(
    (acc, deletion) => acc + Math.max(0, deletion.endOffset - deletion.startOffset),
    0,
  )
  const bracketChars = bracketsForSection
    .filter((b) => b.deletionIndex !== WHOLE_SECTION_DELETION_INDEX)
    .reduce((acc, b) => acc + b.bracketText.length, 0)
  return Math.max(0, section.rawText.length - deletedChars) + bracketChars
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

type RenderContext = {
  input: LedgerInput
  decisionsById: Map<string, MacroDecision>
  microById: Map<string, MicroDecision>
  bracketsBySection: Map<string, LedgerBracket[]>
  stats: LedgerStats
}

function renderMarkdown(ctx: RenderContext): string {
  const sections = [...ctx.input.sections].sort((a, b) => a.order - b.order)
  const parts: string[] = [
    renderHeader(ctx),
    renderSummary(ctx, sections),
    renderModelsAndPrompts(ctx),
    renderSpine(ctx.input.spine),
    renderCanonical(ctx.input.canonicalPassages),
    renderSectionLedger(ctx, sections),
  ]
  return parts.join('\n\n').trimEnd() + '\n'
}

function renderHeader(ctx: RenderContext): string {
  const title = ctx.input.parsedBook.title?.trim() || stripExtension(ctx.input.originalFileName)
  const generated = formatDateTime(ctx.input.finishedAt)
  const cost = formatCost(ctx.input.totalCostUsd)
  return [
    `# Abridgement Ledger — ${escapeInline(title)}`,
    '',
    `> Generated by **The Abridger** on ${generated}`,
    `> Run ID: \`${escapeBackticks(ctx.input.runId)}\``,
    `> Reading purpose: _${escapeEmphasis(ctx.input.purpose)}_`,
    `> Total cost: ${cost}`,
  ].join('\n')
}

function renderSummary(ctx: RenderContext, sections: Section[]): string {
  const pageOrSpineLabel = ctx.input.parsedBook.format === 'epub' ? 'spine entries' : 'pages'
  const sectionsWithCuts = countSectionsWithCuts(ctx, sections)
  return [
    '## Summary',
    '',
    `- Original: **${ctx.stats.originalLengthChars.toLocaleString('en-US')} characters** across ${ctx.input.parsedBook.pages.length} ${pageOrSpineLabel}`,
    `- Abridged: **${ctx.stats.abridgedLengthChars.toLocaleString('en-US')} characters** (${formatPercent(ctx.stats.reductionPercent)} reduction)`,
    `- Sections: ${ctx.stats.sectionsKeptFull} kept full, ${ctx.stats.sectionsKeptPartial} kept partial, ${ctx.stats.sectionsCompressed} compressed, ${ctx.stats.sectionsDropped} dropped to one line`,
    `- Micro cuts: ${ctx.stats.microCutsTotal} across ${sectionsWithCuts} sections, replaced by ${ctx.stats.bracketsTotal} bracketed editorial summaries`,
  ].join('\n')
}

function countSectionsWithCuts(ctx: RenderContext, sections: Section[]): number {
  return sections.reduce((acc, section) => {
    const micro = ctx.microById.get(section.id)
    return acc + (micro && micro.deletions.length > 0 ? 1 : 0)
  }, 0)
}

function renderModelsAndPrompts(ctx: RenderContext): string {
  const mappingRows = Object.entries(ctx.input.modelMapping)
    .map(([role, model]) => `| ${escapeTableCell(role)} | ${escapeTableCell(model)} |`)
    .join('\n')
  const tableBody = mappingRows.length > 0 ? mappingRows : '| — | (no role mappings recorded) |'
  const hashLines = Object.entries(ctx.input.promptHashes)
    .map(([name, hash]) => {
      const display = hash.slice(0, PROMPT_HASH_DISPLAY_LEN)
      return `- ${escapeInline(name)}: \`${escapeBackticks(display)}\``
    })
    .join('\n')
  const hashesBlock = hashLines.length > 0 ? hashLines : '- (no prompt fingerprints recorded)'
  return [
    '## Models & prompts',
    '',
    '| Role | Model |',
    '|---|---|',
    tableBody,
    '',
    'Prompt fingerprints (first 12 chars of SHA256):',
    hashesBlock,
  ].join('\n')
}

function renderSpine(spine: NarrativeSpine): string {
  const motifs =
    spine.recurringMotifs.length > 0
      ? spine.recurringMotifs.map(escapeInline).join(', ')
      : '_none recorded_'
  return [
    '## Narrative spine',
    '',
    escapeBlock(spine.centralArgument),
    '',
    `**Shape:** ${escapeInline(spine.narrativeShape)}`,
    '',
    `**Recurring motifs:** ${motifs}`,
  ].join('\n')
}

function renderCanonical(passages: CanonicalPassage[]): string {
  if (passages.length === 0) {
    return ['## Canonical passages preserved', '', 'No canonical passages identified.'].join('\n')
  }
  const lines = passages.map((p) => {
    const matched = p.matchedSnippet?.trim()
    const matchClause = matched ? ` (matched: "${escapeInline(truncate(matched, 140))}")` : ''
    return `- _${escapeEmphasis(p.description)}_ — preserved${matchClause}`
  })
  return ['## Canonical passages preserved', '', ...lines].join('\n')
}

function renderSectionLedger(ctx: RenderContext, sections: Section[]): string {
  const intro = '## Section-by-section ledger'
  if (sections.length === 0) {
    return [intro, '', '_No sections recorded for this run._'].join('\n')
  }
  const rendered = sections.map((section) => renderSection(ctx, section))
  return [intro, '', rendered.join('\n\n')].join('\n')
}

function renderSection(ctx: RenderContext, section: Section): string {
  const decision = ctx.decisionsById.get(section.id)
  const verdict: MacroVerdict = decision?.verdict ?? 'KEEP_FULL'
  const verdictLabel = VERDICT_LABELS[verdict]
  const rationale = decision?.rationale?.trim() || '_(no rationale recorded)_'
  const forward = formatDependencyList(decision?.forwardDependencies ?? [])
  const backward = formatDependencyList(decision?.backwardDependencies ?? [])

  const header = [
    `### Section ${section.order}: ${escapeInline(section.title)}`,
    `- **Original pages:** ${section.startPage}–${section.endPage}`,
    `- **Verdict:** ${verdictLabel}`,
    `- **Rationale:** ${escapeInline(rationale)}`,
    `- **Forward dependencies:** ${forward}`,
    `- **Backward dependencies:** ${backward}`,
  ].join('\n')

  if (verdict === 'COMPRESS_TO_BRACKET' || verdict === 'DROP_TO_ONE_LINE') {
    return [header, renderWholeSectionBracket(ctx, section)].join('\n')
  }
  return [header, renderMicroCuts(ctx, section)].join('\n')
}

function formatDependencyList(deps: string[]): string {
  if (deps.length === 0) return 'none'
  return deps.map((d) => `\`${escapeBackticks(d)}\``).join(', ')
}

function renderWholeSectionBracket(ctx: RenderContext, section: Section): string {
  const brackets = ctx.bracketsBySection.get(section.id) ?? []
  const wholeSection = brackets.find((b) => b.deletionIndex === WHOLE_SECTION_DELETION_INDEX)
  const bracketBody = wholeSection?.bracketText.trim() || '_(bracket text pending)_'
  return ['- **Replacement bracket:**', formatBlockquote(bracketBody)].join('\n')
}

function renderMicroCuts(ctx: RenderContext, section: Section): string {
  const micro = ctx.microById.get(section.id)
  const deletions = micro?.deletions ?? []
  if (deletions.length === 0) {
    return '- (Kept verbatim.)'
  }
  const brackets = ctx.bracketsBySection.get(section.id) ?? []
  const bracketsByIndex = brackets.reduce((acc, b) => {
    const next = new Map(acc)
    next.set(b.deletionIndex, b)
    return next
  }, new Map<number, LedgerBracket>())

  const lines = deletions.flatMap((deletion, index) => {
    const matching = bracketsByIndex.get(index)
    const bracketText = matching?.bracketText.trim() || '_(bracket text pending)_'
    const rationale = deletion.dropRationale?.trim() || '(no rationale recorded)'
    return [
      `  - **Cut #${index + 1}** (${deletion.bracketLengthHint}): ${escapeInline(rationale)}`,
      formatBlockquote(bracketText, '    '),
    ]
  })
  return ['- **Micro cuts:**', ...lines].join('\n')
}

function formatBlockquote(text: string, indent = '  '): string {
  const trimmed = text.trim()
  if (trimmed.length === 0) return `${indent}>`
  return trimmed
    .split(/\r?\n/)
    .map((line) => `${indent}> ${line}`)
    .join('\n')
}

function buildFilename(input: LedgerInput): string {
  const candidate = input.parsedBook.title?.trim() || stripExtension(input.originalFileName).trim()
  const slug = toKebabCase(candidate)
  if (slug.length === 0) {
    const fallback = input.runId.replace(/[^a-zA-Z0-9]/g, '').slice(0, RUN_ID_FALLBACK_LEN)
    return `abridgement-ledger-${fallback || 'run'}.md`
  }
  const suffix = '-abridgement-ledger.md'
  const maxSlugLen = FILENAME_MAX_LEN - suffix.length
  const trimmedSlug = slug.slice(0, Math.max(1, maxSlugLen)).replace(/-+$/, '')
  return `${trimmedSlug || 'book'}${suffix}`
}

function toKebabCase(input: string): string {
  const ascii = input.normalize('NFKD').replace(/[̀-ͯ]/g, '')
  return ascii
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function stripExtension(name: string): string {
  return name.replace(/\.[^./\\]+$/, '')
}

function formatDateTime(epochMs: number): string {
  const d = new Date(epochMs)
  if (Number.isNaN(d.getTime())) return 'unknown'
  const pad = (n: number) => String(n).padStart(2, '0')
  const yyyy = d.getUTCFullYear()
  const mm = pad(d.getUTCMonth() + 1)
  const dd = pad(d.getUTCDate())
  const hh = pad(d.getUTCHours())
  const mi = pad(d.getUTCMinutes())
  return `${yyyy}-${mm}-${dd} ${hh}:${mi} UTC`
}

function formatCost(usd: number): string {
  if (!Number.isFinite(usd) || usd <= 0) return '$0.00'
  return `$${usd.toFixed(2)}`
}

function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value
  return `${value.slice(0, max - 1)}…`
}

function escapeInline(text: string): string {
  return text.replace(/[\\`*_{}[\]()#+\-!|<>~]/g, (ch) => `\\${ch}`)
}

function escapeEmphasis(text: string): string {
  return text.replace(/[\\*_`]/g, (ch) => `\\${ch}`)
}

function escapeBackticks(text: string): string {
  return text.replace(/`/g, '\\`')
}

function escapeTableCell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\n/g, ' ')
}

function escapeBlock(text: string): string {
  return text.replace(/\\/g, '\\\\')
}
