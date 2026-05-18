import { Buffer as RealBuffer } from 'buffer'
import matter from 'gray-matter'
import type { Role } from '../types'

// gray-matter calls Buffer.from at module import time. The main entry
// (src/main.tsx) installs the full Buffer global, but if this module is
// imported in a context where main hasn't run yet (e.g. vitest/jsdom, or
// during the ES-module import chain before main's body executes), Buffer
// would be missing. Install the full implementation defensively — note we
// install the real Buffer from the `buffer` package, not a partial stub,
// because callers downstream (the Anthropic/OpenAI SDKs) use
// Buffer.byteLength as well as Buffer.from.
function ensureBufferShim(): void {
  const g = globalThis as unknown as { Buffer?: typeof RealBuffer }
  if (typeof g.Buffer === 'undefined' || typeof g.Buffer.byteLength !== 'function') {
    g.Buffer = RealBuffer
  }
}
ensureBufferShim()

export type PromptResponseFormat = 'json' | 'text'

export type PromptMeta = {
  role: Role
  temperature: number
  responseFormat: PromptResponseFormat
  maxTokens?: number
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
  const maxTokens = data.maxTokens

  if (!isRole(role)) {
    throw new Error(`Prompt "${name}" front-matter: invalid or missing "role"`)
  }
  if (typeof temperature !== 'number' || !Number.isFinite(temperature)) {
    throw new Error(`Prompt "${name}" front-matter: invalid or missing "temperature"`)
  }
  if (!isResponseFormat(responseFormat)) {
    throw new Error(`Prompt "${name}" front-matter: invalid or missing "responseFormat"`)
  }
  const meta: PromptMeta = { role, temperature, responseFormat }
  if (maxTokens !== undefined) {
    if (typeof maxTokens !== 'number' || !Number.isFinite(maxTokens) || maxTokens <= 0) {
      throw new Error(`Prompt "${name}" front-matter: "maxTokens" must be a positive number`)
    }
    meta.maxTokens = maxTokens
  }
  return meta
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
