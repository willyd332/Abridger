import OpenAI from 'openai'
import type {
  CallOptions,
  ProviderAdapter,
  RawProviderResponse,
} from './types'

export type OpenAIAdapterConfig = {
  apiKey: string
  defaultMaxTokens?: number
  baseURL?: string
}

const DEFAULT_MAX_TOKENS = 4096

export function createOpenAIAdapter(config: OpenAIAdapterConfig): ProviderAdapter {
  const client = new OpenAI({
    apiKey: config.apiKey,
    dangerouslyAllowBrowser: true,
    baseURL: config.baseURL,
  })

  const call = async (model: string, opts: CallOptions): Promise<RawProviderResponse> => {
    const messages: Array<{ role: 'system' | 'user'; content: string }> = []
    if (opts.system) messages.push({ role: 'system', content: opts.system })
    messages.push({ role: 'user', content: opts.user })

    const responseFormat = mapResponseFormat(opts.responseFormat)

    const result = await client.chat.completions
      .create(
        {
          model,
          messages,
          max_completion_tokens: opts.maxTokens ?? config.defaultMaxTokens ?? DEFAULT_MAX_TOKENS,
          temperature: opts.temperature,
          ...(responseFormat ? { response_format: responseFormat } : {}),
        },
        { signal: opts.signal },
      )
      .withResponse()

    const completion = result.data
    const choice = completion.choices?.[0]
    const text = choice?.message?.content ?? ''
    const usage = completion.usage ?? { prompt_tokens: 0, completion_tokens: 0 }
    return {
      text,
      promptTokens: usage.prompt_tokens ?? 0,
      completionTokens: usage.completion_tokens ?? 0,
      raw: completion,
      responseHeaders: headersToObject(result.response.headers),
    }
  }

  return { provider: 'openai', call }
}

function mapResponseFormat(
  fmt: CallOptions['responseFormat'],
):
  | { type: 'json_schema'; json_schema: { name: string; schema: Record<string, unknown>; strict: boolean } }
  | { type: 'text' }
  | undefined {
  if (!fmt) return undefined
  if (fmt === 'text') return { type: 'text' }
  if (typeof fmt === 'object' && 'jsonSchema' in fmt) {
    return {
      type: 'json_schema',
      json_schema: {
        name: 'response',
        schema: fmt.jsonSchema as Record<string, unknown>,
        strict: true,
      },
    }
  }
  return undefined
}

function headersToObject(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {}
  headers.forEach((value, key) => {
    out[key.toLowerCase()] = value
  })
  return out
}
