import { useEffect, useRef } from 'react'
import type { SectionRecord, ModelMapping } from '@/state'
import { SectionCard } from './SectionCard'

interface SectionGridProps {
  sections: SectionRecord[]
  modelMapping?: ModelMapping
  activeSectionIds?: string[]
}

function shortenModel(name: string | undefined): string | undefined {
  if (!name) return undefined
  if (/haiku/i.test(name)) return 'Haiku'
  if (/sonnet/i.test(name)) return 'Sonnet'
  if (/opus/i.test(name)) return 'Opus'
  if (/o1/i.test(name)) return 'o1'
  if (/o3/i.test(name)) return 'o3'
  if (/gpt-4o-mini/i.test(name)) return 'GPT-4o mini'
  if (/gpt-4o/i.test(name)) return 'GPT-4o'
  if (/gpt-4/i.test(name)) return 'GPT-4'
  if (/gpt/i.test(name)) return 'GPT'
  return name.length > 18 ? `${name.slice(0, 17)}…` : name
}

function pickModelForSection(
  record: SectionRecord,
  modelMapping?: ModelMapping,
): string | undefined {
  if (!modelMapping) return undefined
  const ps = record.phaseStatus
  if (ps.D?.status === 'in_flight' || ps.D?.status === 'done') return shortenModel(modelMapping.smart)
  if (ps.C2?.status === 'in_flight' || ps.C2?.status === 'done') return shortenModel(modelMapping.smart)
  if (ps.C15?.status === 'in_flight' || ps.C15?.status === 'done') return shortenModel(modelMapping.reasoning)
  if (ps.C1?.status === 'in_flight' || ps.C1?.status === 'done') return shortenModel(modelMapping.smart)
  if (ps.B?.status === 'in_flight' || ps.B?.status === 'done') return shortenModel(modelMapping.cheap)
  return shortenModel(modelMapping.cheap)
}

export function SectionGrid({
  sections,
  modelMapping,
  activeSectionIds,
}: SectionGridProps) {
  const gridRef = useRef<HTMLDivElement>(null)
  const activeSet = new Set(activeSectionIds ?? [])

  useEffect(() => {
    const node = gridRef.current
    if (!node) return
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      if (!target?.classList.contains('section-card')) return
      const cards = Array.from(node.querySelectorAll<HTMLElement>('.section-card'))
      const idx = cards.indexOf(target)
      if (idx === -1) return
      let next = idx
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = Math.min(idx + 1, cards.length - 1)
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = Math.max(idx - 1, 0)
      else return
      event.preventDefault()
      cards[next].focus()
    }
    node.addEventListener('keydown', handler)
    return () => node.removeEventListener('keydown', handler)
  }, [])

  if (sections.length === 0) {
    return (
      <div className="section-grid section-grid--empty">
        <p className="section-grid__empty-note">
          The book is being sectioned. Cards will appear as the press finds chapter
          breaks.
        </p>
      </div>
    )
  }

  return (
    <div className="section-grid" ref={gridRef} role="list">
      {sections.map((record) => {
        const isActive = activeSet.size === 0 || activeSet.has(record.sectionId)
        const modelLabel = pickModelForSection(record, modelMapping)
        return (
          <div
            key={record.sectionId}
            role="listitem"
            data-active={isActive ? 'true' : 'false'}
            className="section-grid__item"
          >
            <SectionCard
              order={record.order + 1}
              title={record.section.title}
              phaseStatus={record.phaseStatus}
              decision={record.macroDecision?.verdict}
              escalated={
                record.macroDecision &&
                record.phaseStatus.C15?.status === 'done' &&
                record.macroDecision.verdict === 'KEEP_PARTIAL'
              }
              modelLabel={modelLabel}
            />
          </div>
        )
      })}
    </div>
  )
}
