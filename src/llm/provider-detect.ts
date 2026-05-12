import type { Provider } from './types'

export type ProviderDetectionResult = {
  provider: Provider | null
  looksValid: boolean
}

export function detectProvider(key: string): ProviderDetectionResult {
  if (typeof key !== 'string') {
    return { provider: null, looksValid: false }
  }
  const trimmed = key.trim()
  if (trimmed.length === 0) {
    return { provider: null, looksValid: false }
  }
  if (trimmed.startsWith('sk-ant-')) {
    return { provider: 'anthropic', looksValid: true }
  }
  if (trimmed.startsWith('sk-proj-') || trimmed.startsWith('sk-')) {
    return { provider: 'openai', looksValid: true }
  }
  return { provider: null, looksValid: false }
}
