import Anthropic from '@anthropic-ai/sdk'
import type {
  CallOptions,
  ProviderAdapter,
  RawProviderResponse,
} from './types'

export type AnthropicAdapterConfig = {
  apiKey: string
  defaultMaxTokens?: number
  baseURL?: string
}

const DEFAULT_MAX_TOKENS = 4096

export function createAnthropicAdapter(config: AnthropicAdapterConfig): ProviderAdapter {
  const client = new Anthropic({
    apiKey: config.apiKey,
    dangerouslyAllowBrowser: true,
    baseURL: config.baseURL,
  })

  const call = async (model: string, opts: CallOptions): Promise<RawProviderResponse> => {
    // Anthropic's reasoning models (Opus 4.x and newer) no longer accept the
    // `temperature` parameter; passing it returns 400 invalid_request_error
    // with "`temperature` is deprecated for this model." We detect those
    // models by name and skip the param. Safer than maintaining a model
    // allowlist: when in doubt, omit.
    const isReasoningModel = /opus|o1|o3/i.test(model)
    type CreateBody = {
      model: string
      system?: string
      max_tokens: number
      temperature?: number
      messages: Array<{ role: 'user'; content: string }>
    }
    const body: CreateBody = {
      model,
      system: opts.system,
      max_tokens: opts.maxTokens ?? config.defaultMaxTokens ?? DEFAULT_MAX_TOKENS,
      messages: [{ role: 'user', content: opts.user }],
    }
    if (!isReasoningModel && typeof opts.temperature === 'number') {
      body.temperature = opts.temperature
    }
    const result = await client.messages
      .create(body, { signal: opts.signal })
      .withResponse()

    const message = result.data
    const text = extractText(message.content)
    return {
      text,
      promptTokens: message.usage.input_tokens,
      completionTokens: message.usage.output_tokens,
      raw: message,
      responseHeaders: headersToObject(result.response.headers),
    }
  }

  return { provider: 'anthropic', call }
}

type AnthropicContentBlockLike = { type: string }

function extractText(content: ReadonlyArray<AnthropicContentBlockLike>): string {
  return content
    .filter(
      (b): b is { type: 'text'; text: string } =>
        b.type === 'text' && typeof (b as { text?: unknown }).text === 'string',
    )
    .map((b) => b.text)
    .join('')
}

function headersToObject(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {}
  headers.forEach((value, key) => {
    out[key.toLowerCase()] = value
  })
  return out
}
