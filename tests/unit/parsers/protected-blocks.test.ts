import { describe, expect, it } from 'vitest'

import { classifyProtected } from '@/parsers/protected-blocks'
import type { Block } from '@/parsers/types'

const makeBlock = (id: string, text: string, overrides: Partial<Block> = {}): Block => ({
  id,
  text,
  classification: 'body',
  pageNumber: 1,
  ...overrides,
})

describe('classifyProtected — verse detection', () => {
  it('marks a run of short non-terminated lines as protected', () => {
    const blocks: Block[] = [
      makeBlock('p1-0', 'Tyger Tyger, burning bright'),
      makeBlock('p1-1', 'In the forests of the night'),
      makeBlock('p1-2', 'What immortal hand or eye'),
      makeBlock('p1-3', 'Could frame thy fearful symmetry'),
    ]
    const result = classifyProtected(blocks)
    for (const block of result) {
      expect(block.classification).toBe('protected')
    }
  })

  it('leaves prose paragraphs alone', () => {
    const blocks: Block[] = [
      makeBlock(
        'p1-0',
        'This is an ordinary paragraph of prose that explains an argument at sufficient length that it cannot reasonably be mistaken for verse, and it ends with proper punctuation.',
      ),
      makeBlock(
        'p1-1',
        'Another long sentence follows the first, also concluding cleanly with a full stop.',
      ),
    ]
    const result = classifyProtected(blocks)
    expect(result.every((b) => b.classification === 'body')).toBe(true)
  })

  it('only protects the verse run inside mixed prose-and-verse content', () => {
    const blocks: Block[] = [
      makeBlock(
        'p1-0',
        'The narrator paused before reciting the lines that had haunted her since childhood, holding the book with care.',
      ),
      makeBlock('p1-1', 'Tyger Tyger, burning bright'),
      makeBlock('p1-2', 'In the forests of the night'),
      makeBlock('p1-3', 'What immortal hand or eye'),
      makeBlock(
        'p1-4',
        'She closed the book and considered the implications of what she had read, which were many and various.',
      ),
    ]
    const result = classifyProtected(blocks)
    expect(result[0].classification).toBe('body')
    expect(result[1].classification).toBe('protected')
    expect(result[2].classification).toBe('protected')
    expect(result[3].classification).toBe('protected')
    expect(result[4].classification).toBe('body')
  })
})

describe('classifyProtected — cast / dramatis personae detection', () => {
  it('protects a dramatis personae heading and the short character entries that follow', () => {
    const blocks: Block[] = [
      makeBlock('p1-0', 'Dramatis Personae'),
      makeBlock('p1-1', 'CLAUDIUS, King of Denmark'),
      makeBlock('p1-2', 'HAMLET, son to the late, and nephew to the present king'),
      makeBlock('p1-3', 'POLONIUS, Lord Chamberlain'),
      makeBlock(
        'p1-4',
        'ACT I. SCENE I. Elsinore. A platform before the castle. Enter the guards, in the deep cold of midnight, speaking softly so as not to disturb the watch above.',
      ),
    ]
    const result = classifyProtected(blocks)
    expect(result[0].classification).toBe('protected')
    expect(result[1].classification).toBe('protected')
    expect(result[2].classification).toBe('protected')
    expect(result[3].classification).toBe('protected')
    expect(result[4].classification).toBe('body')
  })
})

describe('classifyProtected — font hints', () => {
  it('marks monospace blocks as protected', () => {
    const blocks: Block[] = [
      makeBlock('p1-0', 'function helloWorld() { return 42 }'),
      makeBlock('p1-1', 'A normal prose sentence about programming.'),
    ]
    const result = classifyProtected(blocks, {
      fontLookup: (b) => (b.id === 'p1-0' ? 'CourierNew-Regular' : undefined),
    })
    expect(result[0].classification).toBe('protected')
    expect(result[1].classification).toBe('body')
  })

  it('marks math-font blocks as protected', () => {
    const blocks: Block[] = [makeBlock('p1-0', 'x = a + b')]
    const result = classifyProtected(blocks, {
      fontLookup: () => 'CMSY10',
    })
    expect(result[0].classification).toBe('protected')
  })
})
