import { useMemo } from 'react'
import { useAppStore, selectSections, type SectionRecord } from '@/state'
import { Button } from '@/components/ui/Button'

interface LivePreviewPaneProps {
  onCancel?: () => void
}

interface PreviewSegment {
  kind: 'kept' | 'deleted'
  text: string
  bracketText?: string
}

function buildSegments(record: SectionRecord): PreviewSegment[] {
  const raw = record.section.rawText
  const decision = record.microDecision
  if (!decision || decision.deletions.length === 0) {
    return [{ kind: 'kept', text: raw }]
  }
  const segments: PreviewSegment[] = []
  const deletions = [...decision.deletions].sort((a, b) => a.startOffset - b.startOffset)
  let cursor = 0
  const clamp = (n: number) => Math.max(0, Math.min(raw.length, n))
  for (const d of deletions) {
    const start = clamp(d.startOffset)
    const end = clamp(d.endOffset)
    if (start < cursor || end <= start) continue
    if (start > cursor) segments.push({ kind: 'kept', text: raw.slice(cursor, start) })
    segments.push({ kind: 'deleted', text: raw.slice(start, end) })
    cursor = end
  }
  if (cursor < raw.length) segments.push({ kind: 'kept', text: raw.slice(cursor) })
  return segments
}

const MAX_PREVIEW_CHARS = 1600

function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return `${text.slice(0, max).trimEnd()}…`
}

export function LivePreviewPane({ onCancel }: LivePreviewPaneProps) {
  const sections = useAppStore(selectSections)

  const previewSections = useMemo(() => {
    return sections
      .filter((s) => s.section.order < 2)
      .filter((s) => {
        const ps = s.phaseStatus
        return ps.B?.status === 'done' || ps.C2?.status !== 'pending'
      })
      .slice(0, 2)
  }, [sections])

  const hasContent = previewSections.length > 0

  return (
    <aside className="live-preview" aria-label="Live preview pane">
      <header className="live-preview__head">
        <h3 className="live-preview__title">Live preview</h3>
        <p className="live-preview__caption">
          Preview updates as the run progresses.
        </p>
      </header>

      <div className="live-preview__body">
        {!hasContent ? (
          <p className="live-preview__empty">
            Preview will appear once the first section is reconstructed.
          </p>
        ) : (
          previewSections.map((record) => {
            const segments = buildSegments(record)
            const truncated = segments.reduce<{ total: number; out: PreviewSegment[] }>(
              (acc, seg) => {
                if (acc.total >= MAX_PREVIEW_CHARS) return acc
                const remaining = MAX_PREVIEW_CHARS - acc.total
                const piece = seg.text.length > remaining ? seg.text.slice(0, remaining) : seg.text
                return {
                  total: acc.total + piece.length,
                  out: [...acc.out, { ...seg, text: piece }],
                }
              },
              { total: 0, out: [] },
            )
            return (
              <article key={record.sectionId} className="live-preview__section">
                <h4 className="live-preview__section-title">
                  {record.section.title || `Section ${record.order + 1}`}
                </h4>
                <p className="live-preview__section-body">
                  {truncated.out.map((seg, idx) => {
                    if (seg.kind === 'deleted') {
                      return (
                        <span key={idx} className="live-preview__deleted">
                          <del>{truncate(seg.text, 220)}</del>
                          {seg.bracketText ? (
                            <em className="live-preview__bracket">
                              {' '}
                              [{seg.bracketText}]{' '}
                            </em>
                          ) : null}
                        </span>
                      )
                    }
                    return <span key={idx}>{seg.text}</span>
                  })}
                </p>
              </article>
            )
          })
        )}
      </div>

      <footer className="live-preview__foot">
        {onCancel ? (
          <Button variant="ghost" onClick={onCancel} aria-label="Abort the run">
            Abort run
          </Button>
        ) : null}
      </footer>
    </aside>
  )
}
