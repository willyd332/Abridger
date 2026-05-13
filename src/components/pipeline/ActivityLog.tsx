import { useEffect, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useAppStore, type ActivityEntry } from '@/state'

function formatTime(ts: number): string {
  const d = new Date(ts)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  return `${hh}:${mm}:${ss}`
}

function shortPhase(phase: string): string {
  return phase
    .replace(/^A-structure$/, 'A')
    .replace(/^A5-canonical$/, 'A.5')
    .replace(/^B-summarize$/, 'B')
    .replace(/^B5-spine$/, 'B.5')
    .replace(/^C1-macro$/, 'C1')
    .replace(/^C1\.5-sanity$/, 'C1.5')
    .replace(/^C2-micro$/, 'C2')
    .replace(/^D-bracket-writer$/, 'bracket')
}

function formatDuration(entry: ActivityEntry): string {
  if (!entry.endedAt) {
    const elapsed = Date.now() - entry.startedAt
    return `${(elapsed / 1000).toFixed(1)}s`
  }
  return `${((entry.endedAt - entry.startedAt) / 1000).toFixed(1)}s`
}

function statusLabel(entry: ActivityEntry): string {
  if (entry.status === 'in_flight') return 'in flight'
  if (entry.status === 'retrying') return `retry ${entry.attempt}`
  if (entry.status === 'error') return 'error'
  return 'done'
}

function rowClass(entry: ActivityEntry): string {
  return `activity-log__row activity-log__row--${entry.status}`
}

export function ActivityLog() {
  const entries = useAppStore(useShallow((state) => state.activityLog))
  const listRef = useRef<HTMLDivElement | null>(null)

  // Force re-render every 1s so in-flight elapsed timers tick.
  useTick(entries.some((e) => e.status === 'in_flight' || e.status === 'retrying'))

  useEffect(() => {
    const el = listRef.current
    if (!el) return
    el.scrollTop = 0
  }, [entries.length])

  const inFlight = entries.filter(
    (e) => e.status === 'in_flight' || e.status === 'retrying',
  ).length

  return (
    <section className="activity-log" aria-label="LLM call activity log" aria-live="polite">
      <header className="activity-log__header">
        <h3 className="activity-log__title">Activity log</h3>
        <span className="activity-log__count">
          {entries.length} {entries.length === 1 ? 'call' : 'calls'}
          {inFlight > 0 ? ` · ${inFlight} in flight` : ''}
        </span>
      </header>
      <div className="activity-log__body" ref={listRef}>
        {entries.length === 0 ? (
          <p className="activity-log__empty">
            No LLM calls yet. The first dispatch will appear here as soon as
            the orchestrator fires it.
          </p>
        ) : (
          <ul className="activity-log__list">
            {entries.map((entry) => (
              <li key={entry.id} className={rowClass(entry)}>
                <span className="activity-log__time">{formatTime(entry.startedAt)}</span>
                <span className="activity-log__phase">phase {shortPhase(entry.phase)}</span>
                <span className="activity-log__role">{entry.role}</span>
                <span className="activity-log__model" title={entry.model}>
                  {entry.model}
                </span>
                {entry.sectionId ? (
                  <span className="activity-log__section" title={entry.sectionId}>
                    {entry.sectionId.slice(0, 12)}
                  </span>
                ) : null}
                <span className="activity-log__duration">{formatDuration(entry)}</span>
                <span className={`activity-log__status activity-log__status--${entry.status}`}>
                  {statusLabel(entry)}
                </span>
                {entry.status === 'done' &&
                entry.promptTokens !== undefined &&
                entry.completionTokens !== undefined ? (
                  <span className="activity-log__tokens">
                    in {entry.promptTokens.toLocaleString()} · out{' '}
                    {entry.completionTokens.toLocaleString()}
                  </span>
                ) : null}
                {entry.status === 'done' && entry.costUsd !== undefined ? (
                  <span className="activity-log__cost">${entry.costUsd.toFixed(4)}</span>
                ) : null}
                {entry.status === 'error' && entry.errorMessage ? (
                  <pre className="activity-log__error" title={entry.errorMessage}>
                    {entry.errorMessage}
                  </pre>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}

function useTick(active: boolean): void {
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!active) return
    const id = window.setInterval(() => setTick((t) => t + 1), 1000)
    return () => window.clearInterval(id)
  }, [active])
}
