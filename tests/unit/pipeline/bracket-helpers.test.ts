import { describe, expect, it } from 'vitest'

import { getFollowingContext, getPrecedingContext } from '@/pipeline/bracket-helpers'
import type { Section } from '@/pipeline/types'

function makeSection(rawText: string): Section {
  return {
    id: 'sec-1',
    order: 1,
    title: 'Section',
    startPage: 1,
    endPage: 1,
    blocks: [],
    rawText,
    source: 'llm-detected',
    confidence: 0.8,
  }
}

describe('getPrecedingContext', () => {
  it('returns empty string at offset 0', () => {
    const section = makeSection('Para one.\n\nPara two.\n\nPara three.')
    expect(getPrecedingContext(section, 0)).toBe('')
  })

  it('returns the previous paragraph by default', () => {
    const section = makeSection('Para one.\n\nPara two.\n\nPara three.')
    // The "\n\n" after "Para two." ends at index 20.
    // Position pointing into "Para three." should return "Para two."
    const idx = section.rawText.indexOf('Para three.')
    const ctx = getPrecedingContext(section, idx)
    expect(ctx).toContain('Para two.')
    expect(ctx).not.toContain('Para three.')
  })

  it('clamps to at most 600 chars', () => {
    const long = 'A'.repeat(2000)
    const section = makeSection(long + '\n\nNext paragraph.')
    const ctx = getPrecedingContext(section, long.length)
    expect(ctx.length).toBeLessThanOrEqual(600)
  })

  it('returns up to multiple paragraphs when asked', () => {
    const section = makeSection('Para one.\n\nPara two.\n\nPara three.')
    const idx = section.rawText.indexOf('Para three.')
    const ctx = getPrecedingContext(section, idx, 2)
    expect(ctx).toContain('Para one.')
    expect(ctx).toContain('Para two.')
  })
})

describe('getFollowingContext', () => {
  it('returns empty string at end of text', () => {
    const section = makeSection('Para one.\n\nPara two.')
    expect(getFollowingContext(section, section.rawText.length)).toBe('')
  })

  it('returns the next paragraph by default', () => {
    const section = makeSection('Para one.\n\nPara two.\n\nPara three.')
    const idx = section.rawText.indexOf('Para one.\n\n')
    expect(idx).toBeGreaterThanOrEqual(0)
    const after = section.rawText.indexOf('Para two.')
    const ctx = getFollowingContext(section, after - 2)
    expect(ctx).toContain('Para two.')
    expect(ctx).not.toContain('Para three.')
  })

  it('clamps to at most 600 chars', () => {
    const long = 'B'.repeat(2000)
    const section = makeSection('Header.\n\n' + long)
    const ctx = getFollowingContext(section, 'Header.\n\n'.length)
    expect(ctx.length).toBeLessThanOrEqual(600)
  })

  it('handles text with no paragraph breaks', () => {
    const section = makeSection('A single paragraph with no breaks anywhere in it.')
    const ctx = getFollowingContext(section, 0)
    expect(ctx).toContain('single paragraph')
  })
})
