export type Provider = 'anthropic' | 'openai'

export type Role = 'cheap' | 'smart' | 'reasoning'

export type ProviderModelMap = Record<Role, string>

export type RoleMapping = Record<Provider, ProviderModelMap>

export type ResponseFormat = 'text' | { jsonSchema: object }

export type CallMetadata = {
  phase: string
  sectionId?: string
  requestId: string
}

export type CallOptions = {
  role: Role
  system?: string
  user: string
  responseFormat?: ResponseFormat
  maxTokens?: number
  temperature?: number
  signal?: AbortSignal
  metadata: CallMetadata
}

export type CallWithBookContentOptions = CallOptions & {
  bookContent: string
}

export type Usage = {
  promptTokens: number
  completionTokens: number
  totalTokens: number
  costUsd: number
}

export type LLMError =
  | { kind: 'rate-limited'; retryAfterMs: number }
  | { kind: 'authentication'; message: string }
  | { kind: 'context-overflow'; message: string }
  | { kind: 'invalid-response'; message: string; raw?: unknown }
  | { kind: 'aborted' }
  | { kind: 'budget-exceeded'; reservedUsd: number; ceilingUsd: number }
  | { kind: 'network'; message: string }
  | { kind: 'unknown'; message: string; raw?: unknown }

export type CallResult<T = string> =
  | { ok: true; data: T; usage: Usage; raw: unknown }
  | { ok: false; error: LLMError; retried: number }

export type CostCeiling = {
  ceilingUsd: number
  reservedUsd: number
  billedUsd: number
}

export type RateLimitSnapshot = {
  requestsRemaining: number | null
  tokensRemaining: number | null
  requestsResetAt: number | null
  tokensResetAt: number | null
}

export type ProviderAdapter = {
  provider: Provider
  call: (model: string, opts: CallOptions) => Promise<RawProviderResponse>
}

export type RawProviderResponse = {
  text: string
  promptTokens: number
  completionTokens: number
  raw: unknown
  responseHeaders: Record<string, string>
}
