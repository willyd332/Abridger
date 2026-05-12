import matter from 'gray-matter'
import type { Role } from '../types'

// Defensive shim: gray-matter assigns Buffer.from(content) to file.orig.
// In the browser there is no Node Buffer; we provide a no-op stand-in so
// the assignment doesn't blow up. We never read .orig.
function ensureBufferShim(): void {
  const g = globalThis as unknown as { Buffer?: { from: (input: unknown) => unknown } }
  if (typeof g.Buffer === 'undefined') {
    g.Buffer = { from: (input: unknown) => input }
  }
}
ensureBufferShim()

export type PromptResponseFormat = 'json' | 'text'

export type PromptMeta = {
  role: Role
  temperature: number
  responseFormat: PromptResponseFormat
}

export type LoadedPrompt = {
  name: string
  meta: PromptMeta
  body: string
}

const rawModules = import.meta.glob('./*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

function fileBase(path: string): string {
  const slash = path.lastIndexOf('/')
  const file = slash >= 0 ? path.slice(slash + 1) : path
  return file.replace(/\.md$/i, '')
}

function isRole(v: unknown): v is Role {
  return v === 'cheap' || v === 'smart' || v === 'reasoning'
}

function isResponseFormat(v: unknown): v is PromptResponseFormat {
  return v === 'json' || v === 'text'
}

function normalizeMeta(name: string, data: Record<string, unknown>): PromptMeta {
  const role = data.role
  const temperature = data.temperature
  const responseFormat = data.responseFormat

  if (!isRole(role)) {
    throw new Error(`Prompt "${name}" front-matter: invalid or missing "role"`)
  }
  if (typeof temperature !== 'number' || !Number.isFinite(temperature)) {
    throw new Error(`Prompt "${name}" front-matter: invalid or missing "temperature"`)
  }
  if (!isResponseFormat(responseFormat)) {
    throw new Error(`Prompt "${name}" front-matter: invalid or missing "responseFormat"`)
  }
  return { role, temperature, responseFormat }
}

const cache = new Map<string, LoadedPrompt>()

function loadAll(): Map<string, LoadedPrompt> {
  if (cache.size > 0) return cache
  for (const [path, raw] of Object.entries(rawModules)) {
    const name = fileBase(path)
    const parsed = matter(raw)
    const meta = normalizeMeta(name, parsed.data as Record<string, unknown>)
    cache.set(name, { name, meta, body: parsed.content.trim() })
  }
  return cache
}

export function getPrompt(name: string): LoadedPrompt {
  const all = loadAll()
  const prompt = all.get(name)
  if (!prompt) {
    throw new Error(`Prompt not found: ${name}`)
  }
  return prompt
}

export function listPrompts(): ReadonlyArray<string> {
  return Array.from(loadAll().keys()).sort()
}
