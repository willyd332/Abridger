export type ProviderId = 'anthropic' | 'openai' | 'unknown'

export function detectProvider(rawKey: string): ProviderId {
  const key = rawKey.trim()
  if (key.length === 0) return 'unknown'
  if (key.startsWith('sk-ant-')) return 'anthropic'
  if (key.startsWith('sk-')) return 'openai'
  return 'unknown'
}
