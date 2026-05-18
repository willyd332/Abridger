import { z } from 'zod'

import type { LLMClient } from '@/llm/client'
import { parseLlmJsonOrThrow } from '@/llm/parse-json'
import { getPrompt } from '@/llm/prompts/loader'

import { buildTitleChain, collectLeafIdsInOrder } from './inclusion'
import type { OntologyTree } from './types'

export const PHASE_NAME = 'O-suggest'

const responseSchema = z.object({
  exclude: z.array(
    z.object({
      nodeId: z.string().min(1),
      rationale: z.string().min(1),
    }),
  ),
  summary: z.string().optional(),
})

export type SuggestOptions = {
  signal?: AbortSignal
  targetKeepRatio?: number
}

export type SuggestResult = {
  excludedLeafIds: string[]
  excludedNodeIds: string[]
  rationales: Record<string, string>
  summary: string
}

export async function suggestAbridgement(
  tree: OntologyTree,
  purpose: string,
  client: LLMClient,
  opts: SuggestOptions = {},
): Promise<SuggestResult> {
  const targetRatio = opts.targetKeepRatio ?? 0.5

  // Flatten depth-first, skipping the root itself
  const lines: string[] = []
  let totalLeafBytes = 0
  const collect = (id: string): void => {
    const node = tree.nodes[id]
    if (!node) return
    if (id !== tree.rootId) {
      const chain = buildTitleChain(tree, id).join(' › ')
      const summary = node.summary?.text ?? '(no summary)'
      const bytes = node.endOffset - node.startOffset
      if (node.isLeaf) totalLeafBytes += bytes
      lines.push(
        `- id=${id}, depth=${node.depth}, "${chain}", ${bytes} bytes — ${summary}`,
      )
    }
    for (const childId of node.childIds) collect(childId)
  }
  collect(tree.rootId)

  const targetExcludeBytes = Math.round((1 - targetRatio) * totalLeafBytes)

  const prompt = getPrompt('ontology-suggest-abridgement')
  const baseUser = [
    `Reading purpose: ${purpose}`,
    `Target keep ratio: ${targetRatio.toFixed(2)} (keep ~${Math.round(targetRatio * 100)}% by bytes, exclude ~${Math.round((1 - targetRatio) * 100)}%)`,
    `Total analyzed bytes across all leaves: ${totalLeafBytes.toLocaleString()}`,
    `Target exclude bytes (your sum should approach this): ${targetExcludeBytes.toLocaleString()}`,
    '',
    'Ontology (depth-first, root omitted):',
    ...lines,
    '',
    'Return JSON: {"exclude":[{"nodeId":"…","rationale":"…"}], "summary":"…"}',
  ].join('\n')

  const callOnce = async (
    userBody: string,
    requestSuffix: string,
  ): Promise<{ ok: boolean; raw?: string; parsed?: z.infer<typeof responseSchema> }> => {
    const result = await client.call({
      role: prompt.meta.role,
      temperature: prompt.meta.temperature,
      responseFormat: prompt.meta.responseFormat === 'json' ? { jsonSchema: {} } : 'text',
      maxTokens: prompt.meta.maxTokens,
      system: prompt.body,
      user: userBody,
      signal: opts.signal,
      metadata: {
        phase: PHASE_NAME,
        requestId: `phaseSuggest-${requestSuffix}`,
      },
    })
    if (!result.ok) return { ok: false }
    // eslint-disable-next-line no-console
    console.log('[suggest] raw response', {
      length: result.data?.length ?? 0,
      preview: typeof result.data === 'string' ? result.data.slice(0, 600) : '',
    })
    try {
      return {
        ok: true,
        raw: result.data,
        parsed: responseSchema.parse(parseLlmJsonOrThrow(result.data)),
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[suggest] parse failure', err)
      return { ok: true, raw: result.data }
    }
  }

  const first = await callOnce(baseUser, Date.now().toString(36))
  let parsed = first.parsed

  // Retry once if the model returned a suspiciously empty exclude array.
  // Two conditions both required: target asked for meaningful cuts AND the
  // returned list either is empty or sums to far less than the target.
  const summed = (entries: Array<{ nodeId: string }>): number => {
    let total = 0
    for (const e of entries) {
      const n = tree.nodes[e.nodeId]
      if (!n) continue
      total += n.endOffset - n.startOffset
    }
    return total
  }

  if (parsed && targetRatio < 0.85) {
    const excludeBytes = summed(parsed.exclude)
    const undershoot = excludeBytes < targetExcludeBytes * 0.5
    if (parsed.exclude.length === 0 || undershoot) {
      // eslint-disable-next-line no-console
      console.warn('[suggest] undershoot — retrying with force prompt', {
        firstExcludeCount: parsed.exclude.length,
        firstExcludeBytes: excludeBytes,
        targetExcludeBytes,
      })
      const forceUser =
        baseUser +
        '\n\nRETRY: the previous pass returned ' +
        (parsed.exclude.length === 0 ? 'NO exclusions' : `only ~${Math.round((excludeBytes / totalLeafBytes) * 100)}% of bytes`) +
        '. The reader explicitly asked for ' +
        `keep≈${Math.round(targetRatio * 100)}% / exclude≈${Math.round((1 - targetRatio) * 100)}% by bytes. ` +
        'Look harder. Drop entire chapters/parts that are tangential to the purpose. ' +
        'Return a substantial exclude list whose summed bytes approach ' +
        `${targetExcludeBytes.toLocaleString()}.`
      const retry = await callOnce(forceUser, `${Date.now().toString(36)}-retry`)
      if (retry.parsed && retry.parsed.exclude.length > parsed.exclude.length) {
        parsed = retry.parsed
      }
    }
  }

  if (!first.ok) {
    return {
      excludedLeafIds: [],
      excludedNodeIds: [],
      rationales: {},
      summary: 'The model could not produce a suggestion.',
    }
  }
  if (!parsed) {
    return {
      excludedLeafIds: [],
      excludedNodeIds: [],
      rationales: {},
      summary: 'The model returned an unparseable response.',
    }
  }

  const excludedNodeIds: string[] = []
  const rationales: Record<string, string> = {}
  const leafIdSet = new Set<string>()
  for (const entry of parsed.exclude) {
    const node = tree.nodes[entry.nodeId]
    if (!node) continue
    if (entry.nodeId === tree.rootId) continue
    excludedNodeIds.push(entry.nodeId)
    rationales[entry.nodeId] = entry.rationale
    for (const lid of collectLeafIdsInOrder(tree, entry.nodeId)) {
      leafIdSet.add(lid)
    }
  }

  return {
    excludedLeafIds: [...leafIdSet],
    excludedNodeIds,
    rationales,
    summary: parsed.summary ?? '',
  }
}
