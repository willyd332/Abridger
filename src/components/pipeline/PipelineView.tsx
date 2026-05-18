import {
  useAppStore,
  selectCurrentPhase,
} from '@/state'
import { CostMeter } from '@/components/cost/CostMeter'
import { BookSpine } from './BookSpine'
import { ActivityLog } from './ActivityLog'

interface PipelineViewProps {
  onPause?: () => void
  onResume?: () => void
  onCancel?: () => void
}

const PHASE_DESCRIPTIONS: Record<string, string> = {
  'A-structure': 'Reading the book’s structure and laying out chapter boundaries.',
  'A5-canonical': 'Identifying canonical passages the abridgement should preserve.',
  'O-ontology': 'Building the recursive ontology — chapter → subtopic → sub-subtopic → leaf.',
  'S-leaf': 'Summarizing each 2–5 page leaf node.',
  'S-internal': 'Synthesizing internal-node summaries from their children.',
}

function describePhase(phase: string | null): string {
  if (!phase) return 'The press is warming.'
  return PHASE_DESCRIPTIONS[phase] ?? `Working in phase ${phase}.`
}

export function PipelineView({
  onPause,
  onResume,
  onCancel,
}: PipelineViewProps) {
  const currentPhase = useAppStore(selectCurrentPhase)
  const runStatus = useAppStore((state) => state.job?.run.status)

  return (
    <div className="pipeline-view">
      <CostMeter
        onPause={onPause}
        onResume={onResume}
        onCancel={onCancel}
        runStatus={runStatus}
      />

      <section className="pipeline-view__intro">
        <h2 className="pipeline-view__title">The press is at work</h2>
        <p className="pipeline-view__lede" aria-live="polite">
          {describePhase(currentPhase)}
        </p>
      </section>

      <section className="pipeline-view__spine">
        <BookSpine totalSections={0} active />
      </section>

      <ActivityLog />
    </div>
  )
}
