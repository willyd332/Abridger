import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import type { ResumableRunSummary } from '@/state'

interface ResumePromptProps {
  summary: ResumableRunSummary
  onResume: () => void
  onDiscard: () => void
}

function formatTime(ts: number): string {
  try {
    return new Date(ts).toLocaleString()
  } catch {
    return '—'
  }
}

export function ResumePrompt({ summary, onResume, onDiscard }: ResumePromptProps) {
  return (
    <div className="resume-prompt" role="dialog" aria-label="Resume previous run">
      <Card
        title="Resume previous run?"
        hint="An earlier abridgement is still cached in this browser."
      >
        <dl className="resume-prompt__dl">
          <div>
            <dt>Phase</dt>
            <dd>{summary.phase || '—'}</dd>
          </div>
          <div>
            <dt>Started</dt>
            <dd>{formatTime(summary.createdAt)}</dd>
          </div>
          <div>
            <dt>Last update</dt>
            <dd>{formatTime(summary.updatedAt)}</dd>
          </div>
          <div>
            <dt>Cost so far</dt>
            <dd>${summary.costBilledUsd.toFixed(2)} / ${summary.costCeilingUsd.toFixed(2)}</dd>
          </div>
          {summary.purpose ? (
            <div className="resume-prompt__purpose">
              <dt>Reading purpose</dt>
              <dd>{summary.purpose}</dd>
            </div>
          ) : null}
        </dl>
        <div className="resume-prompt__actions">
          <Button variant="primary" glow onClick={onResume} aria-label="Resume the previous run">
            Resume
          </Button>
          <Button variant="ghost" onClick={onDiscard} aria-label="Discard and start fresh">
            Discard
          </Button>
        </div>
      </Card>
    </div>
  )
}
