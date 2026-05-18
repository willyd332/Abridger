export type {
  BracketLengthHint,
  Emit,
  NarrativeFunction,
  NarrativeSpine,
  PhaseEvent,
  Section,
  SectionDensity,
  SectionSignals,
  SectionSource,
} from './types'

export { phaseAStructure } from './phaseA-structure'
export type { OutlineNode, PhaseAOptions, PhaseAResult } from './phaseA-structure'

export { writeBracket, extractNamedTerms } from './bracket-writer'
export type { BracketRequest, BracketResult, BracketUsage } from './bracket-writer'

export { getPrecedingContext, getFollowingContext } from './bracket-helpers'

export { buildOntology, PHASE_O_NAME } from './ontology/build'
export type { PhaseOOptions, PhaseOInput } from './ontology/build'

export { summarizeOntology } from './ontology/summarize'
export type { PhaseSOptions, PhaseSResult } from './ontology/summarize'

export { buildFragments, generateBrackets } from './ontology/export'
export type { ExportInputs } from './ontology/export'

export { exportToPdf } from './ontology/export-pdf'
export type { PdfExportInput, PdfExportOutput } from './ontology/export-pdf'

export { exportToEpub } from './ontology/export-epub'
export type { EpubExportInput, EpubExportOutput } from './ontology/export-epub'

export { findDependencies } from './ontology/find-dependencies'
export type { FindDependenciesOptions } from './ontology/find-dependencies'

export { suggestAbridgement } from './ontology/suggest-abridgement'
export type { SuggestOptions, SuggestResult } from './ontology/suggest-abridgement'

export type {
  OntologyNode,
  OntologyTree,
  NodeSummary,
  NodeDependencies,
  NodeDependency,
  Fragment,
  InclusionState,
  OntologySource,
} from './ontology/types'

export {
  bytesToLengthHint,
  LEAF_BYTE_BUDGET,
  MAX_CHILDREN_PER_NODE,
  MAX_TREE_DEPTH,
} from './ontology/types'

export {
  startOntologyRun,
} from './ontology/orchestrate'
export type {
  StartOntologyRunInput,
  StartOntologyRunResult,
  OntologyRunHandle,
  OntologyRunCompletion,
} from './ontology/orchestrate'
