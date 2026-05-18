import { mapWithLimit } from '@/lib/concurrency'
import type { LLMClient } from '@/llm/client'

import { extractNamedTerms, writeBracket } from '../bracket-writer'
import type { NarrativeSpine } from '../types'

import { getInclusionState } from './inclusion'
import {
  BRACKET_LENGTH_THRESHOLDS,
  bytesToLengthHint,
  type Fragment,
  type OntologyTree,
} from './types'

const CONTEXT_CHARS = 240

const EMPTY_SPINE: NarrativeSpine = {
  centralArgument: '',
  narrativeShape: '',
  recurringMotifs: [],
  voiceAnchors: [],
}

export function buildFragments(
  tree: OntologyTree,
  inclusion: Record<string, boolean>,
): Fragment[] {
  const out: Fragment[] = []
  walk(tree, tree.rootId, inclusion, out)
  return mergeAdjacentBrackets(out)
}

function walk(
  tree: OntologyTree,
  nodeId: string,
  inclusion: Record<string, boolean>,
  out: Fragment[],
): void {
  const node = tree.nodes[nodeId]
  if (!node) return
  if (node.isLeaf) {
    const included = inclusion[node.id] !== false
    if (included) {
      out.push({
        kind: 'keep',
        nodeId: node.id,
        startOffset: node.startOffset,
        endOffset: node.endOffset,
      })
    } else {
      const bytes = node.endOffset - node.startOffset
      out.push({
        kind: 'bracket',
        nodeId: node.id,
        startOffset: node.startOffset,
        endOffset: node.endOffset,
        bytes,
        lengthHint: bytesToLengthHint(bytes),
      })
    }
    return
  }
  const state = getInclusionState(tree, node.id, inclusion)
  if (state === 'all') {
    out.push({
      kind: 'keep',
      nodeId: node.id,
      startOffset: node.startOffset,
      endOffset: node.endOffset,
    })
    return
  }
  if (state === 'none') {
    const bytes = node.endOffset - node.startOffset
    out.push({
      kind: 'bracket',
      nodeId: node.id,
      startOffset: node.startOffset,
      endOffset: node.endOffset,
      bytes,
      lengthHint: bytesToLengthHint(bytes),
    })
    return
  }
  for (const childId of node.childIds) {
    walk(tree, childId, inclusion, out)
  }
}

function mergeAdjacentBrackets(fragments: Fragment[]): Fragment[] {
  const out: Fragment[] = []
  for (const fragment of fragments) {
    const last = out[out.length - 1]
    if (
      last &&
      last.kind === 'bracket' &&
      fragment.kind === 'bracket' &&
      last.endOffset === fragment.startOffset
    ) {
      const bytes = (last.endOffset - last.startOffset) + (fragment.endOffset - fragment.startOffset)
      out[out.length - 1] = {
        kind: 'bracket',
        nodeId: last.nodeId,
        startOffset: last.startOffset,
        endOffset: fragment.endOffset,
        bytes,
        lengthHint: bytesToLengthHint(bytes),
      }
      continue
    }
    out.push(fragment)
  }
  return out
}

export type ExportInputs = {
  tree: OntologyTree
  inclusion: Record<string, boolean>
  bookText: string
  spine?: NarrativeSpine | null
  voiceSample?: string
  purpose?: string
  client: LLMClient
  signal?: AbortSignal
  concurrency?: number
  /**
   * Optional callback fired after each bracket finishes (success OR fallback).
   * Lets UI render an N-of-M progress indicator during export.
   */
  onBracketDone?: (done: number, total: number) => void
}

function leadingContext(bookText: string, offset: number): string {
  const start = Math.max(0, offset - CONTEXT_CHARS)
  return bookText.slice(start, offset)
}

function trailingContext(bookText: string, offset: number): string {
  const end = Math.min(bookText.length, offset + CONTEXT_CHARS)
  return bookText.slice(offset, end)
}

export async function generateBrackets(
  fragments: Fragment[],
  inputs: ExportInputs,
): Promise<Array<{ nodeId: string; text: string }>> {
  const brackets = fragments.filter((f): f is Extract<Fragment, { kind: 'bracket' }> => f.kind === 'bracket')
  if (brackets.length === 0) return []

  const concurrency = inputs.concurrency ?? 4
  const spine = inputs.spine ?? EMPTY_SPINE
  const voiceSample = inputs.voiceSample ?? ''
  const purpose = inputs.purpose ?? ''

  const total = brackets.length
  let done = 0
  const notify = (): void => {
    done += 1
    try {
      inputs.onBracketDone?.(done, total)
    } catch {
      // listener failures must not break the export
    }
  }

  const results = await mapWithLimit(brackets, concurrency, async (frag) => {
    if (inputs.signal?.aborted) {
      notify()
      return { nodeId: frag.nodeId, text: '' }
    }
    const deletedText = inputs.bookText.slice(frag.startOffset, frag.endOffset)
    const preceding = leadingContext(inputs.bookText, frag.startOffset)
    const following = trailingContext(inputs.bookText, frag.endOffset)
    const named = extractNamedTerms(deletedText)
    try {
      const bracket = await writeBracket(
        {
          deletedText,
          precedingContext: preceding,
          followingContext: following,
          targetLength: frag.lengthHint,
          spine,
          voiceSample,
          purpose,
          namedTermsToPreserve: named,
          scope: 'macro',
        },
        inputs.client,
        { signal: inputs.signal },
      )
      notify()
      return { nodeId: frag.nodeId, text: bracket.text }
    } catch (err) {
      notify()
      return {
        nodeId: frag.nodeId,
        text: `[Editorial bracket unavailable. Original passage covered ${frag.bytes.toLocaleString()} characters.]`,
      }
    }
  })

  return results
}

export const __test__ = {
  walk,
  mergeAdjacentBrackets,
  BRACKET_LENGTH_THRESHOLDS,
}
