import type { Section } from './types'

const MAX_CONTEXT_CHARS = 600
const PARAGRAPH_BOUNDARY_RE = /\n\s*\n/g

function clampToMax(text: string, fromEnd: boolean): string {
  if (text.length <= MAX_CONTEXT_CHARS) return text
  if (fromEnd) {
    return text.slice(text.length - MAX_CONTEXT_CHARS)
  }
  return text.slice(0, MAX_CONTEXT_CHARS)
}

function paragraphStarts(text: string): number[] {
  const starts: number[] = [0]
  PARAGRAPH_BOUNDARY_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = PARAGRAPH_BOUNDARY_RE.exec(text))) {
    const start = match.index + match[0].length
    if (start < text.length && start !== starts[starts.length - 1]) {
      starts.push(start)
    }
    if (match.index === PARAGRAPH_BOUNDARY_RE.lastIndex) PARAGRAPH_BOUNDARY_RE.lastIndex += 1
  }
  return starts
}

function paragraphEnds(text: string): number[] {
  const ends: number[] = []
  PARAGRAPH_BOUNDARY_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = PARAGRAPH_BOUNDARY_RE.exec(text))) {
    ends.push(match.index)
    if (match.index === PARAGRAPH_BOUNDARY_RE.lastIndex) PARAGRAPH_BOUNDARY_RE.lastIndex += 1
  }
  ends.push(text.length)
  return ends
}

export function getPrecedingContext(
  section: Section,
  charOffset: number,
  paragraphs: number = 1,
): string {
  if (charOffset <= 0) return ''
  const text = section.rawText
  const upTo = Math.min(Math.max(0, charOffset), text.length)
  const head = text.slice(0, upTo)
  const trimmedHead = head.replace(/\s+$/, '')
  if (trimmedHead.length === 0) return ''
  const starts = paragraphStarts(trimmedHead)
  const target = Math.max(0, starts.length - paragraphs)
  const start = starts[target]
  const slice = trimmedHead.slice(start).trim()
  if (!slice) {
    return clampToMax(head.trim(), true).trim()
  }
  return clampToMax(slice, true).trim()
}

export function getFollowingContext(
  section: Section,
  charOffset: number,
  paragraphs: number = 1,
): string {
  const text = section.rawText
  if (charOffset >= text.length) return ''
  const from = Math.max(0, charOffset)
  const tail = text.slice(from)
  const trimmedTail = tail.replace(/^\s+/, '')
  if (trimmedTail.length === 0) return ''
  const ends = paragraphEnds(trimmedTail)
  const target = Math.min(paragraphs - 1, ends.length - 1)
  const end = ends[target] ?? trimmedTail.length
  const slice = trimmedTail.slice(0, end).trim()
  return clampToMax(slice, false).trim()
}
