import { z } from 'zod'

import type { LLMClient } from '@/llm/client'
import { parseLlmJsonOrThrow } from '@/llm/parse-json'
import { getPrompt } from '@/llm/prompts/loader'

import { buildTitleChain } from './inclusion'
import type {
  NodeDependencies,
  NodeDependency,
  OntologyTree,
} from './types'

export const PHASE_NAME = 'O-dependencies'

const responseSchema = z.object({
  dependencies: z.array(
    z.object({
      nodeId: z.string().min(1),
      rationale: z.string().min(1),
    }),
  ),
})

export type FindDependenciesOptions = {
  signal?: AbortSignal
  maxDownstreamNodes?: number
}

function listDownstreamNodes(
  tree: OntologyTree,
  focalId: string,
  maxNodes: number,
): string[] {
  // Collect all leaf nodes in reading order, then take those whose
  // order comes after the focal node's leaves.
  const focal = tree.nodes[focalId]
  if (!focal) return []
  const focalEnd = focal.endOffset
  const out: string[] = []
  for (const id of tree.leafIdsInOrder) {
    const node = tree.nodes[id]
    if (!node) continue
    if (node.startOffset < focalEnd) continue
    if (id === focalId) continue
    out.push(id)
    if (out.length >= maxNodes) break
  }
  return out
}

export async function findDependencies(
  tree: OntologyTree,
  focalNodeId: string,
  client: LLMClient,
  opts: FindDependenciesOptions = {},
): Promise<NodeDependencies> {
  const focal = tree.nodes[focalNodeId]
  if (!focal) {
    return {
      focalNodeId,
      downstream: [],
      computedAt: Date.now(),
      model: 'none',
    }
  }
  const maxNodes = opts.maxDownstreamNodes ?? 80
  const downstreamIds = listDownstreamNodes(tree, focalNodeId, maxNodes)
  if (downstreamIds.length === 0) {
    return {
      focalNodeId,
      downstream: [],
      computedAt: Date.now(),
      model: 'none',
    }
  }

  const prompt = getPrompt('ontology-find-dependencies')
  const focalChain = buildTitleChain(tree, focalNodeId).join(' › ')
  const focalSummary = focal.summary?.text ?? '(no summary available)'

  const downstreamLines = downstreamIds.map((id, idx) => {
    const node = tree.nodes[id]
    const chain = buildTitleChain(tree, id).join(' › ')
    const summary = node?.summary?.text ?? '(no summary available)'
    return `${idx + 1}. id=${id} | ${chain}\n   ${summary}`
  })

  const user = [
    'Focal node:',
    `id: ${focalNodeId}`,
    `title chain: ${focalChain}`,
    `summary: ${focalSummary}`,
    '',
    'Downstream nodes (in reading order):',
    ...downstreamLines,
    '',
    'Return JSON: {"dependencies":[{"nodeId":"…","rationale":"…"}]}.',
    'Only include nodes that directly rely on the focal node\'s arguments, names, definitions, or evidence.',
  ].join('\n')

  const result = await client.call({
    role: prompt.meta.role,
    temperature: prompt.meta.temperature,
    responseFormat: prompt.meta.responseFormat === 'json' ? { jsonSchema: {} } : 'text',
    maxTokens: prompt.meta.maxTokens,
    system: prompt.body,
    user,
    signal: opts.signal,
    metadata: {
      phase: PHASE_NAME,
      sectionId: focalNodeId,
      requestId: `phaseDeps-${focalNodeId}`,
    },
  })

  if (!result.ok) {
    return {
      focalNodeId,
      downstream: [],
      computedAt: Date.now(),
      model: 'error',
    }
  }

  try {
    const parsed = responseSchema.parse(parseLlmJsonOrThrow(result.data))
    const known = new Set(downstreamIds)
    const downstream: NodeDependency[] = parsed.dependencies
      .filter((d) => known.has(d.nodeId))
      .map((d) => ({ nodeId: d.nodeId, rationale: d.rationale }))
    return {
      focalNodeId,
      downstream,
      computedAt: Date.now(),
      model: 'ok',
    }
  } catch {
    return {
      focalNodeId,
      downstream: [],
      computedAt: Date.now(),
      model: 'parse-error',
    }
  }
}

export const __test__ = {
  listDownstreamNodes,
}
