import { useEffect, useRef, useState } from 'react'
import type { SectionRecord, ModelMapping } from '@/state'
import type { PhaseName } from '@/state/types'

interface SectionGridProps {
  sections: SectionRecord[]
  modelMapping?: ModelMapping
  activeSectionIds?: string[]
}

const PHASES: ReadonlyArray<{ key: PhaseName; label: string; title: string }> = [
  { key: 'A', label: 'A', title: 'Structural detection' },
  { key: 'A5', label: 'A·', title: 'Canonical passages' },
  { key: 'B', label: 'B', title: 'Section summary' },
  { key: 'B5', label: 'B·', title: 'Narrative spine' },
  { key: 'C1', label: 'C1', title: 'Macro verdict' },
  { key: 'C15', label: 'C·', title: 'Sanity escalation' },
  { key: 'C2', label: 'C2', title: 'Micro deletions' },
  { key: 'D', label: 'D', title: 'Reconstruction' },
]

function shortenModel(name: string | undefined): string | undefined {
  if (!name) return undefined
  if (/haiku/i.test(name)) return 'Haiku'
  if (/sonnet/i.test(name)) return 'Sonnet'
  if (/opus/i.test(name)) return 'Opus'
  if (/o1/i.test(name)) return 'o1'
  if (/o3/i.test(name)) return 'o3'
  if (/gpt-4o-mini/i.test(name)) return 'GPT-4o mini'
  if (/gpt-4o/i.test(name)) return 'GPT-4o'
  if (/gpt/i.test(name)) return 'GPT'
  return name.length > 14 ? `${name.slice(0, 13)}…` : name
}

function pickLatestModelForSection(
  record: SectionRecord,
  modelMapping?: ModelMapping,
): string | undefined {
  if (!modelMapping) return undefined
  const ps = record.phaseStatus
  const inProgress = (s: { status: string } | undefined) =>
    s?.status === 'in_flight' || s?.status === 'done'
  if (inProgress(ps.D)) return shortenModel(modelMapping.smart)
  if (inProgress(ps.C2)) return shortenModel(modelMapping.smart)
  if (inProgress(ps.C15)) return shortenModel(modelMapping.reasoning)
  if (inProgress(ps.C1)) return shortenModel(modelMapping.reasoning)
  if (inProgress(ps.B5)) return shortenModel(modelMapping.smart)
  if (inProgress(ps.B)) return shortenModel(modelMapping.smart)
  if (inProgress(ps.A5)) return shortenModel(modelMapping.cheap)
  return shortenModel(modelMapping.cheap)
}

type DecisionBadge =
  | { kind: 'keep'; label: string; symbol: string }
  | { kind: 'partial'; label: string; symbol: string }
  | { kind: 'bracket'; label: string; symbol: string }
  | { kind: 'drop'; label: string; symbol: string }
  | null

function decisionBadge(record: SectionRecord): DecisionBadge {
  const v = record.macroDecision?.verdict
  if (!v) return null
  if (v === 'KEEP_FULL') return { kind: 'keep', label: 'KEEP', symbol: '●' }
  if (v === 'KEEP_PARTIAL') return { kind: 'partial', label: 'PARTIAL', symbol: '◐' }
  if (v === 'COMPRESS_TO_BRACKET') return { kind: 'bracket', label: 'BRACKET', symbol: '◇' }
  if (v === 'DROP_TO_ONE_LINE') return { kind: 'drop', label: 'DROP', symbol: '○' }
  return null
}

function escalated(record: SectionRecord): boolean {
  return (
    record.macroDecision?.verdict === 'KEEP_PARTIAL' &&
    record.phaseStatus.C15?.status === 'done'
  )
}

type DotKind = 'pending' | 'in_flight' | 'done' | 'error' | 'skipped' | 'retrying'

function phaseDot(record: SectionRecord, key: PhaseName): DotKind {
  return (record.phaseStatus[key]?.status ?? 'pending') as DotKind
}

function HoverPanel({ record }: { record: SectionRecord }) {
  const summary = record.section.summary
  const signals = record.section.signals
  const startPage = record.section.startPage
  const endPage = record.section.endPage
  const macro = record.macroDecision
  const microCount = record.microDecision?.deletions.length ?? 0
  return (
    <div className="section-row__hover" role="tooltip">
      <header className="section-row__hover-head">
        <span className="section-row__hover-title">{record.section.title}</span>
        <span className="section-row__hover-pages">pp. {startPage}–{endPage}</span>
      </header>
      {summary ? (
        <p className="section-row__hover-summary">{summary}</p>
      ) : (
        <p className="section-row__hover-summary section-row__hover-summary--placeholder">
          (summary not yet generated)
        </p>
      )}
      {signals ? (
        <p className="section-row__hover-signals">
          {signals.narrativeFunction} · {signals.density} density
          {signals.isCore ? ' · core' : ''}
          {signals.hasFamousArgument ? ' · famous' : ''}
        </p>
      ) : null}
      {macro ? (
        <p className="section-row__hover-rationale">
          <strong>{macro.verdict.replace(/_/g, ' ')}:</strong> {macro.rationale}
        </p>
      ) : null}
      {microCount > 0 ? (
        <p className="section-row__hover-micro">{microCount} micro-cuts</p>
      ) : null}
    </div>
  )
}

export function SectionGrid({
  sections,
  modelMapping,
  activeSectionIds,
}: SectionGridProps) {
  const listRef = useRef<HTMLOListElement | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const activeSet = new Set(activeSectionIds ?? [])

  useEffect(() => {
    const node = listRef.current
    if (!node) return
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      if (!target?.classList.contains('section-row')) return
      const rows = Array.from(node.querySelectorAll<HTMLElement>('.section-row'))
      const idx = rows.indexOf(target)
      if (idx === -1) return
      let next = idx
      if (event.key === 'ArrowDown') next = Math.min(idx + 1, rows.length - 1)
      else if (event.key === 'ArrowUp') next = Math.max(idx - 1, 0)
      else if (event.key === 'Escape') {
        setOpenId(null)
        return
      } else return
      event.preventDefault()
      rows[next].focus()
    }
    node.addEventListener('keydown', handler)
    return () => node.removeEventListener('keydown', handler)
  }, [])

  if (sections.length === 0) {
    return (
      <div className="section-grid section-grid--empty">
        <p className="section-grid__empty-note">
          The book is being sectioned. Rows will appear as the press finds chapter
          breaks.
        </p>
      </div>
    )
  }

  return (
    <ol className="section-grid section-grid--list" ref={listRef}>
      {sections.map((record) => {
        const isActive = activeSet.size === 0 || activeSet.has(record.sectionId)
        const modelLabel = pickLatestModelForSection(record, modelMapping)
        const badge = decisionBadge(record)
        const esc = escalated(record)
        const isOpen = openId === record.sectionId
        return (
          <li
            key={record.sectionId}
            className={`section-row ${isActive ? 'section-row--active' : ''} ${
              isOpen ? 'section-row--open' : ''
            }`}
            tabIndex={0}
            role="button"
            aria-label={`Section ${record.order}: ${record.section.title}`}
            onMouseEnter={() => setOpenId(record.sectionId)}
            onMouseLeave={() => setOpenId((cur) => (cur === record.sectionId ? null : cur))}
            onFocus={() => setOpenId(record.sectionId)}
            onBlur={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                setOpenId((cur) => (cur === record.sectionId ? null : cur))
              }
            }}
          >
            <span className="section-row__order">{record.order}</span>
            <span className="section-row__title" title={record.section.title}>
              {record.section.title}
            </span>
            <span className="section-row__phases" aria-label="Phase progress">
              {PHASES.map((p) => (
                <span
                  key={p.key}
                  className={`section-row__dot section-row__dot--${phaseDot(record, p.key)}`}
                  title={`${p.title}: ${phaseDot(record, p.key)}`}
                >
                  {p.label}
                </span>
              ))}
            </span>
            {badge ? (
              <span
                className={`section-row__badge section-row__badge--${badge.kind}`}
                aria-label={`Decision: ${badge.label}${esc ? ', escalated' : ''}`}
              >
                <span className="section-row__badge-symbol" aria-hidden="true">
                  {badge.symbol}
                </span>
                {badge.label}
                {esc ? <span className="section-row__esc" title="Escalated by sanity pass">↑</span> : null}
              </span>
            ) : (
              <span className="section-row__badge section-row__badge--empty">—</span>
            )}
            {modelLabel ? (
              <span className="section-row__model" title="Most recent model that touched this section">
                {modelLabel}
              </span>
            ) : (
              <span className="section-row__model section-row__model--empty">—</span>
            )}
            {isOpen ? <HoverPanel record={record} /> : null}
          </li>
        )
      })}
    </ol>
  )
}
