import { describe, it, expect } from 'vitest'
import { selectWindows, type ScoredPointer } from '@/lib/windows'

const p = (messageId: string, ordinal: number, score: number, at = 1): ScoredPointer => ({
  messageId, messageCreatedAt: at, ordinal, text: `${messageId}#${ordinal}`, score,
})

describe('selectWindows', () => {
  it('takes the best passage with one neighbour either side, as one excerpt', () => {
    const rows = [p('m', 0, 0), p('m', 1, 0), p('m', 2, 0.9), p('m', 3, 0), p('m', 4, 0)]
    expect(selectWindows(rows, 1).map((e) => e.text)).toEqual(['m#1\nm#2\nm#3'])
  })

  it('merges overlapping windows into one excerpt', () => {
    const rows = [0, 1, 2, 3, 4].map((i) => p('m', i, i === 1 || i === 2 ? 0.9 : 0))
    expect(selectWindows(rows, 2).map((e) => e.text)).toEqual(['m#0\nm#1\nm#2\nm#3'])
  })

  it('never lets a window cross into another message', () => {
    const rows = [p('a', 0, 0, 1), p('a', 1, 0.9, 1), p('b', 0, 0, 2)]
    expect(selectWindows(rows, 1).map((e) => e.text)).toEqual(['a#0\na#1'])
  })

  // Ticket 11's anti-correlation: a rule that prefers short passages keeps
  // the preamble. Ties go to message order, and length is never consulted.
  it('breaks ties by position, never by length', () => {
    const rows = [
      { ...p('m', 0, 0.5), text: 'a very long passage that goes on and on and on' },
      { ...p('m', 5, 0.5), text: 'short' },
    ]
    expect(selectWindows(rows, 1)[0].text).toContain('a very long passage')
  })

  it('returns excerpts in conversation order, not score order', () => {
    const rows = [p('a', 0, 0.2, 1), p('b', 0, 0.9, 2)]
    expect(selectWindows(rows, 2).map((e) => e.text)).toEqual(['a#0', 'b#0'])
  })

  it('returns nothing for a chat with no pointers', () => {
    expect(selectWindows([], 3)).toEqual([])
  })

  it('gives each excerpt the date of its message', () => {
    const rows = [p('a', 0, 0.9, Date.UTC(2026, 0, 12)), p('b', 0, 0.8, Date.UTC(2026, 5, 3))]
    expect(selectWindows(rows, 2).map((e) => e.at)).toEqual([Date.UTC(2026, 0, 12), Date.UTC(2026, 5, 3)])
  })

  // Fix round 1, finding 1 (CRITICAL): scoredPointers' SQL now returns only
  // the picks and their +-1 neighbours, not every passage — so `rows` is
  // sparse, and two windows can sit next to each other in the ARRAY without
  // being next to each other by ORDINAL. Merging on array position (the old
  // bug) would splice non-adjacent windows into one excerpt with the gap
  // silently dropped. selectWindows on the sparse set the SQL actually
  // returns must equal selectWindows on the full, dense chat.
  it('does not merge windows that are adjacent in the array but not in ordinal', () => {
    const full: ScoredPointer[] = Array.from({ length: 11 }, (_, i) => p('m', i, i === 0 || i === 2 || i === 6 ? 0.9 : 0))
    const picked = new Set([0, 2, 6])
    const sparse: ScoredPointer[] = full
      .filter((r) => picked.has(r.ordinal) || picked.has(r.ordinal - 1) || picked.has(r.ordinal + 1))
      .map((r) => (picked.has(r.ordinal) ? r : { ...r, score: -1 }))
    expect(selectWindows(sparse, 3)).toEqual(selectWindows(full, 3))
    // Pin down what "correct" looks like, not just "equal to itself": the gap
    // at ordinal 4 must produce two excerpts, never one merged excerpt.
    expect(selectWindows(full, 3).map((e) => e.text)).toEqual(['m#0\nm#1\nm#2\nm#3', 'm#5\nm#6\nm#7'])
  })
})
