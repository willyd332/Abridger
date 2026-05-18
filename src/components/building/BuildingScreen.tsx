import { useCallback, useEffect, useRef, useState } from 'react'

import type {
  PhaseEvent,
  PhaseSampleSource,
} from '@/pipeline/types'

import { OntologyConstruction, type ConstructionNode } from './OntologyConstruction'
import { ThoughtCascade } from './ThoughtCascade'
import './building.css'

interface Props {
  subscribe: (listener: (event: PhaseEvent) => void) => () => void
  onCancel: () => void
}

const PHASE_LABELS: Record<string, string> = {
  'A-structure': 'Reading the book’s structure',
  'A5-canonical': 'Tracing canonical passages',
  'O-ontology': 'Decomposing chapters into subtopics',
  'S-leaf': 'Summarizing leaves',
  'S-internal': 'Synthesizing chapter summaries',
}

const MAX_QUEUE_BUFFER = 80

type PendingSample = { source: PhaseSampleSource; text: string }

export function BuildingScreen({ subscribe, onCancel }: Props) {
  const [nodes, setNodes] = useState<ConstructionNode[]>([])
  const [currentPhase, setCurrentPhase] = useState<string>('A-structure')
  const [pendingSamples, setPendingSamples] = useState<PendingSample[]>([])
  // Buffer of un-emitted samples; the cascade pulls from this at its own cadence
  const bufferRef = useRef<PendingSample[]>([])

  // Drain buffer to the cascade at a steady tempo (~every 350ms when present)
  useEffect(() => {
    const interval = setInterval(() => {
      if (bufferRef.current.length === 0) return
      // Send up to 2 samples per tick to keep things flowing
      const taking = bufferRef.current.splice(0, 2)
      setPendingSamples((prev) => {
        const next = [...prev, ...taking]
        if (next.length > MAX_QUEUE_BUFFER) {
          return next.slice(next.length - MAX_QUEUE_BUFFER)
        }
        return next
      })
    }, 350)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    const unsubscribe = subscribe((event) => {
      if (event.kind === 'phase-start') {
        setCurrentPhase(event.phase)
      } else if (event.kind === 'phase-progress') {
        setCurrentPhase(event.phase)
      } else if (event.kind === 'phase-sample') {
        // Cascade shows verbatim book text only — reasoning samples are dropped.
        if (event.source !== 'book') return
        bufferRef.current.push({ source: event.source, text: event.text })
        if (bufferRef.current.length > 200) {
          bufferRef.current.splice(0, bufferRef.current.length - 200)
        }
      } else if (event.kind === 'tree-node') {
        setNodes((prev) => {
          const existingIdx = prev.findIndex((n) => n.id === event.nodeId)
          if (existingIdx === -1) {
            return [
              ...prev,
              {
                id: event.nodeId,
                parentId: event.parentId,
                depth: event.depth,
                title: event.title,
                isLeaf: event.isLeaf,
                summarized: event.summarized === true,
              },
            ]
          }
          // Update existing: mark summarized if this event sets it
          if (!event.summarized) return prev
          const next = [...prev]
          next[existingIdx] = { ...next[existingIdx], summarized: true }
          return next
        })
      }
    })
    return unsubscribe
  }, [subscribe])

  const onConsumeSamples = useCallback((count: number) => {
    setPendingSamples((prev) => prev.slice(count))
  }, [])

  const phaseLabel = PHASE_LABELS[currentPhase] ?? 'Building the ontology'

  return (
    <div className="building" role="region" aria-label="Building ontology">
      <div className="building__overlay">
        <div className="building__overlay-left">
          <h1 className="building__title">Book Abridger</h1>
          <p className="building__status" aria-live="polite">
            {phaseLabel} · {nodes.length} nodes
          </p>
        </div>
        <div className="building__overlay-right">
          <button type="button" className="building__cancel" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>

      <section
        className="building__pane building__pane--left"
        aria-label="Ontology construction"
      >
        <OntologyConstruction nodes={nodes} />
      </section>

      <section
        className="building__pane building__pane--right"
        aria-label="Live samples"
      >
        <ThoughtCascade
          pendingSamples={pendingSamples}
          onConsume={onConsumeSamples}
        />
      </section>
    </div>
  )
}
