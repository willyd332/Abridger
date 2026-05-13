// Robust JSON extraction for LLM responses. Models often wrap valid JSON in
// markdown code fences or surround it with prose despite instructions to the
// contrary. This helper tries a few strategies before giving up.

export type ParseJsonResult<T> =
  | { ok: true; value: T }
  | { ok: false; raw: string; reason: string }

function tryParse<T>(s: string): T | null {
  try {
    return JSON.parse(s) as T
  } catch {
    return null
  }
}

function stripFences(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  return fenced ? fenced[1].trim() : text.trim()
}

function extractObjectSubstring(text: string): string | null {
  const firstBrace = text.indexOf('{')
  const lastBrace = text.lastIndexOf('}')
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) return null
  return text.slice(firstBrace, lastBrace + 1)
}

function extractArraySubstring(text: string): string | null {
  const firstBracket = text.indexOf('[')
  const lastBracket = text.lastIndexOf(']')
  if (firstBracket === -1 || lastBracket === -1 || lastBracket <= firstBracket) return null
  return text.slice(firstBracket, lastBracket + 1)
}

export function parseLlmJsonOrThrow(raw: string): unknown {
  const result = parseLlmJson<unknown>(raw)
  if (!result.ok) {
    throw new Error(
      `parseLlmJsonOrThrow: ${result.reason}. First 200 chars: ${raw.slice(0, 200)}`,
    )
  }
  return result.value
}

export function parseLlmJson<T>(raw: string): ParseJsonResult<T> {
  if (typeof raw !== 'string' || raw.length === 0) {
    return { ok: false, raw, reason: 'empty response' }
  }
  const direct = tryParse<T>(raw)
  if (direct !== null) return { ok: true, value: direct }

  const fenced = stripFences(raw)
  if (fenced !== raw) {
    const v = tryParse<T>(fenced)
    if (v !== null) return { ok: true, value: v }
  }

  const objSub = extractObjectSubstring(fenced)
  if (objSub) {
    const v = tryParse<T>(objSub)
    if (v !== null) return { ok: true, value: v }
  }

  const arrSub = extractArraySubstring(fenced)
  if (arrSub) {
    const v = tryParse<T>(arrSub)
    if (v !== null) return { ok: true, value: v }
  }

  return { ok: false, raw, reason: 'no parseable JSON found in response' }
}
