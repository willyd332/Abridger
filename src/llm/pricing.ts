import type { Provider } from './types'

export type PriceEntry = {
  inputPerMillion: number
  outputPerMillion: number
}

export const DEFAULT_PRICING: Record<Provider, Record<string, PriceEntry>> = {
  anthropic: {
    'claude-haiku-4-5-20251001': { inputPerMillion: 1.0, outputPerMillion: 5.0 },
    'claude-sonnet-4-6': { inputPerMillion: 3.0, outputPerMillion: 15.0 },
    'claude-opus-4-7': { inputPerMillion: 15.0, outputPerMillion: 75.0 },
  },
  openai: {
    'gpt-4o-mini': { inputPerMillion: 0.15, outputPerMillion: 0.6 },
    'gpt-4o': { inputPerMillion: 2.5, outputPerMillion: 10.0 },
    o1: { inputPerMillion: 15.0, outputPerMillion: 60.0 },
    'o1-mini': { inputPerMillion: 3.0, outputPerMillion: 12.0 },
    o3: { inputPerMillion: 10.0, outputPerMillion: 40.0 },
    'o3-mini': { inputPerMillion: 1.1, outputPerMillion: 4.4 },
  },
}

const FALLBACK: PriceEntry = { inputPerMillion: 5.0, outputPerMillion: 15.0 }

export function getPrice(provider: Provider, model: string): PriceEntry {
  const table = DEFAULT_PRICING[provider]
  const entry = table[model]
  if (entry) return entry
  return FALLBACK
}

export function computeCostUsd(
  provider: Provider,
  model: string,
  promptTokens: number,
  completionTokens: number,
): number {
  const { inputPerMillion, outputPerMillion } = getPrice(provider, model)
  const inputCost = (promptTokens / 1_000_000) * inputPerMillion
  const outputCost = (completionTokens / 1_000_000) * outputPerMillion
  return inputCost + outputCost
}
