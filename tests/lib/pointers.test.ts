import { describe, it, expect } from 'vitest'
import { pointerRows, describeSkip } from '@/lib/pointers'

describe('pointerRows', () => {
  it('numbers kept spans consecutively from 0', () => {
    const { rows } = pointerRows('One thing. Two things. Three things.')
    expect(rows.map((r) => r.ordinal)).toEqual([0, 1, 2])
  })

  it('stores the span text as match_text', () => {
    const { rows } = pointerRows('Kafka keeps order. Redis caches sessions.')
    expect(rows.map((r) => r.matchText)).toEqual(['Kafka keeps order.', 'Redis caches sessions.'])
  })

  // Postgres substring() counts characters (code points); JS slice counts
  // UTF-16 units, and an emoji is TWO of those. Offsets stored in UTF-16
  // would shift every later sentence of this message by one character.
  it('stores offsets in code points, so an emoji does not shift the text', () => {
    const content = '🎉 Kafka keeps order. Redis caches sessions.'
    const { rows } = pointerRows(content)
    const cps = Array.from(content)
    const last = rows[rows.length - 1]
    expect(cps.slice(last.startChar, last.endChar).join('')).toBe('Redis caches sessions.')
  })

  it('skips a code block over the limit and reports it, keeping the rest', () => {
    const big = '```\n' + 'x'.repeat(50) + '\n```'
    const { rows, skipped } = pointerRows(`Short sentence here.\n\n${big}`, 40)
    expect(rows.map((r) => r.kind)).toEqual(['sentence'])
    expect(skipped).toEqual([{ kind: 'code', length: big.length }])
  })

  it('never skips a sentence for length — the limit is for blocks only', () => {
    const long = 'A' + 'a'.repeat(60) + ' long sentence.'
    const { rows, skipped } = pointerRows(long, 40)
    expect(rows).toHaveLength(1)
    expect(skipped).toEqual([])
  })

  it('returns nothing for whitespace', () => {
    expect(pointerRows('  \n ')).toEqual({ rows: [], skipped: [] })
  })

  it('indexes a 4,000-sentence paste in well under a second', () => {
    // Measured before this fix: 6.7 s. toCodePoints re-counted from the start
    // of the message for every sentence, O(length x sentences).
    const content = Array.from({ length: 4000 }, (_, i) => `Sentence number ${i} talks about Kafka partitions and order.`).join(' ')
    const t = performance.now()
    const { rows } = pointerRows(content)
    expect(rows).toHaveLength(4000)
    expect(performance.now() - t).toBeLessThan(1000)
  })

  it('keeps code-point offsets exact across many emoji', () => {
    const content = Array.from({ length: 50 }, (_, i) => `🎉 Item ${i} is here.`).join(' ')
    const { rows } = pointerRows(content)
    const cps = Array.from(content)
    for (const r of rows) expect(cps.slice(r.startChar, r.endChar).join('')).toBe(r.matchText)
  })

  it('counts a stray high surrogate as one character, matching Array.from', () => {
    // Unpaired high surrogate \uD800 should count as 1 code point, not 2.
    // This reproduces the bug where offsets become misaligned.
    const content = 'First sentence has a stray unit\uD800 in it. Second sentence follows after that.'
    const { rows } = pointerRows(content)
    const cps = Array.from(content)
    for (const r of rows) {
      expect(cps.slice(r.startChar, r.endChar).join('')).toBe(r.matchText)
    }
  })

  it('counts a lone low surrogate as one character, matching Array.from', () => {
    // Unpaired low surrogate \uDC00 should also count as 1 code point.
    const content = 'a\uDC00b. Next one here.'
    const { rows } = pointerRows(content)
    const cps = Array.from(content)
    for (const r of rows) {
      expect(cps.slice(r.startChar, r.endChar).join('')).toBe(r.matchText)
    }
  })
})

describe('describeSkip', () => {
  it('names the message, the chat, the kind and both sizes', () => {
    expect(describeSkip('c1', 'm1', { kind: 'table', length: 5000 })).toBe(
      'message m1 in chat c1: skipped table (5000 chars > 4000 limit)',
    )
  })
})
