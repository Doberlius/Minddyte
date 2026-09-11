import { describe, it, expect } from 'vitest'
import { extractConcepts } from '@/lib/extract'

describe('extractConcepts', () => {
  it('pulls multi-word noun phrases into auto', () => {
    const r = extractConcepts('How does event streaming compare to batch processing?')
    expect(r.auto).toContain('event streaming')
    expect(r.auto).toContain('batch processing')
  })

  it('keeps a dotted identifier intact', () => {
    const r = extractConcepts('We set max.poll.records to 50.')
    expect([...r.auto, ...r.suggested].join(' ')).toContain('max.poll.records')
  })

  it('routes a bare lowercase single word to suggested, not auto', () => {
    const r = extractConcepts('what is the weather')
    expect(r.auto).not.toContain('weather')
    expect(r.suggested).toContain('weather')
  })

  it('returns nothing for a message with no concepts', () => {
    const r = extractConcepts('thanks, that makes sense')
    expect(r.auto).toEqual([])
  })

  it('is deterministic — identical input gives byte-identical output', () => {
    const input = 'How does event streaming compare to batch processing?'
    expect(JSON.stringify(extractConcepts(input)))
      .toBe(JSON.stringify(extractConcepts(input)))
  })

  it('deduplicates repeated phrases within one message', () => {
    const r = extractConcepts('Event streaming is hard. Event streaming needs care.')
    expect(r.auto.filter((x) => x.toLowerCase() === 'event streaming')).toHaveLength(1)
  })
})
