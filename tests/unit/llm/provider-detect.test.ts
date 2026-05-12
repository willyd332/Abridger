import { describe, it, expect } from 'vitest'
import { detectProvider } from '@/llm/provider-detect'

describe('detectProvider', () => {
  it('detects Anthropic from sk-ant- prefix', () => {
    expect(detectProvider('sk-ant-api03-abc123')).toEqual({
      provider: 'anthropic',
      looksValid: true,
    })
  })

  it('detects OpenAI from sk-proj- prefix', () => {
    expect(detectProvider('sk-proj-xyz')).toEqual({
      provider: 'openai',
      looksValid: true,
    })
  })

  it('detects OpenAI from generic sk- prefix (legacy)', () => {
    expect(detectProvider('sk-legacyKeyValue')).toEqual({
      provider: 'openai',
      looksValid: true,
    })
  })

  it('prefers Anthropic detection over generic sk- (longer match first)', () => {
    // sk-ant- is itself a valid sk- prefix; ordering matters
    expect(detectProvider('sk-ant-something')).toEqual({
      provider: 'anthropic',
      looksValid: true,
    })
  })

  it('rejects unknown prefixes', () => {
    expect(detectProvider('foobar-123')).toEqual({
      provider: null,
      looksValid: false,
    })
  })

  it('rejects empty string', () => {
    expect(detectProvider('')).toEqual({
      provider: null,
      looksValid: false,
    })
  })

  it('rejects whitespace-only', () => {
    expect(detectProvider('   ')).toEqual({
      provider: null,
      looksValid: false,
    })
  })

  it('trims surrounding whitespace before detecting', () => {
    expect(detectProvider('  sk-ant-abc  ')).toEqual({
      provider: 'anthropic',
      looksValid: true,
    })
  })

  it('handles non-string input defensively', () => {
    expect(detectProvider(123 as unknown as string)).toEqual({
      provider: null,
      looksValid: false,
    })
  })
})
