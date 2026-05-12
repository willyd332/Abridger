import { useMemo } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import {
  useAppStore,
  selectCurrentPhase,
  selectInFlightSections,
  selectSections,
  type ModelMapping,
} from '@/state'
import { CostMeter } from '@/components/cost/CostMeter'
import { BookSpine } from './BookSpine'
import { SectionGrid } from './SectionGrid'
import { LivePreviewPane } from './LivePreviewPane'

interface PipelineViewProps {
  modelMapping?: ModelMapping
  onPause?: () => void
  onResume?: () => void
  onCancel?: () => void
}

const PHASE_DESCRIPTIONS: Record<string, string> = {
  A: 'Reading the book’s structure and laying out section boundaries.',
  A5: 'Identifying canonical passages the abridgement must preserve.',
  B: 'Reading each section and writing a précis with narrative signals.',
  B5: 'Drafting the narrative spine — central argument, motifs, voice.',
  C1: 'Macro pass: deciding what to keep, partial, bracket, or drop.',
  C15: 'Sanity check: escalating any over-eager drops back to KEEP_PARTIAL.',
  C2: 'Micro pass: marking individual paragraphs for deletion.',
  D: 'Binding the abridged book and writing the ledger of cuts.',
}

function describePhase(phase: string | null): string {
  if (!phase) return 'The press is warming.'
  return PHASE_DESCRIPTIONS[phase] ?? `Working in phase ${phase}.`
}

export function PipelineView({
  modelMapping,
  onPause,
  onResume,
  onCancel,
}: PipelineViewProps) {
  const reduced = useReducedMotion()
  const sections = useAppStore(selectSections)
  const inFlight = useAppStore(selectInFlightSections)
  const currentPhase = useAppStore(selectCurrentPhase)
  const runStatus = useAppStore((state) => state.job?.run.status)

  const phaseIsD = currentPhase === 'D'

  const activeIds = useMemo(
    () => inFlight.slice(0, 4).map((s) => s.sectionId),
    [inFlight],
  )

  const spineActive =
    currentPhase === 'A' || currentPhase === 'A5' || sections.length === 0

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
        <BookSpine totalSections={sections.length} active={spineActive} />
      </section>

      <div className="pipeline-view__main">
        <motion.section
          className="pipeline-view__grid-wrap"
          aria-label="Section progress grid"
          animate={
            reduced || !phaseIsD
              ? { scale: 1 }
              : { scale: [1, 1.02, 0.98, 1] }
          }
          transition={
            reduced || !phaseIsD
              ? { duration: 0 }
              : { duration: 1.4, ease: 'easeInOut' }
          }
        >
          <SectionGrid
            sections={sections}
            modelMapping={modelMapping}
            activeSectionIds={activeIds}
          />
          {phaseIsD ? <BinderyOverlay /> : null}
        </motion.section>

        <LivePreviewPane onCancel={onCancel} />
      </div>
    </div>
  )
}

function BinderyOverlay() {
  const reduced = useReducedMotion()
  return (
    <motion.div
      className="bindery-overlay"
      aria-hidden="true"
      initial={reduced ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: reduced ? 0 : 0.6 }}
    >
      <div className="bindery-overlay__seam" />
      <p className="bindery-overlay__caption">
        Binding the abridged book…
      </p>
    </motion.div>
  )
}
