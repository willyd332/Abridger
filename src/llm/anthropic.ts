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

    // Anthropic's API has no OpenAI-style `response_format: { type: 'json_object' }`.
    // Force structured JSON by prefilling the assistant turn with `{` — the model
    // continues from that prefix. We then prepend `{` back onto the response so
    // downstream parsers see complete JSON. Reasoning models also support this.
    const wantsJson =
      typeof opts.responseFormat === 'object' && opts.responseFormat !== null && 'jsonSchema' in opts.responseFormat

    type CreateBody = {
      model: string
      system?: string
      max_tokens: number
      temperature?: number
      messages: Array<{ role: 'user' | 'assistant'; content: string }>
    }
    const messages: CreateBody['messages'] = [{ role: 'user', content: opts.user }]
    if (wantsJson) {
      messages.push({ role: 'assistant', content: '{' })
    }
    const body: CreateBody = {
      model,
      system: opts.system,
      max_tokens: opts.maxTokens ?? config.defaultMaxTokens ?? DEFAULT_MAX_TOKENS,
      messages,
    }
    if (!isReasoningModel && typeof opts.temperature === 'number') {
      body.temperature = opts.temperature
    }
    let result
    try {
      result = await client.messages
        .create(body, { signal: opts.signal })
        .withResponse()
    } catch (err) {
      // Surface the full Anthropic error body so 400s do not get clipped
      // in the console to "…e.". The SDK's APIError exposes the parsed
      // body on `.error` and the status on `.status`.
      const apiErr = err as {
        status?: number
        error?: unknown
        message?: string
      }
      if (apiErr && typeof apiErr === 'object' && 'status' in apiErr) {
        // eslint-disable-next-line no-console
        console.error('[anthropic-adapter] API error', {
          status: apiErr.status,
          body: apiErr.error,
          message: apiErr.message,
          model: body.model,
          maxTokens: body.max_tokens,
          systemPreview: body.system?.slice(0, 200),
          userPreview: body.messages[0]?.content?.slice(0, 200),
        })
      }
      throw err
    }

    const message = result.data
    const rawText = extractText(message.content)
    const text = wantsJson ? `{${rawText}` : rawText
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
