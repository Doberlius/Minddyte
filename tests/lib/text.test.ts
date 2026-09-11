import { describe, it, expect } from 'vitest'
import { canonicalKey, splitSentences, classifyShape, deriveTitle } from '@/lib/text'

describe('canonicalKey', () => {
  it('lowercases and strips non-alphanumerics', () => {
    expect(canonicalKey('Event Streaming')).toBe('eventstreaming')
    expect(canonicalKey('Next.js')).toBe('nextjs')
    expect(canonicalKey('max.poll.records')).toBe('maxpollrecords')
  })
  it('collapses case differences to one key', () => {
    expect(canonicalKey('KAFKA')).toBe(canonicalKey('kafka'))
  })
})

describe('splitSentences', () => {
  it('splits on sentence terminators and keeps text verbatim', () => {
    expect(splitSentences('We set it to 50. That fixed the timeout.'))
      .toEqual(['We set it to 50.', 'That fixed the timeout.'])
  })
  it('does not split on a decimal point', () => {
    expect(splitSentences('Set max.poll.records to 50 for now.'))
      .toEqual(['Set max.poll.records to 50 for now.'])
  })
  it('returns an empty array for blank input', () => {
    expect(splitSentences('   ')).toEqual([])
  })
})

describe('deriveTitle', () => {
  it('strips a leading question word and truncates', () => {
    expect(deriveTitle('how does event streaming compare to batch processing?'))
      .toBe('Event streaming compare to batch processing')
  })
  it('caps at 60 characters without cutting a word in half', () => {
    const t = deriveTitle('a'.repeat(30) + ' ' + 'b'.repeat(50))
    expect(t.length).toBeLessThanOrEqual(60)
    expect(t.endsWith('b')).toBe(false)
  })
  it('falls back to New Session for empty input', () => {
    expect(deriveTitle('   ')).toBe('New Session')
  })
})

describe('classifyShape', () => {
  it('treats any multi-word phrase as multi', () => {
    expect(classifyShape('event streaming')).toBe('multi')
  })
  it('treats a single word carrying shape as shaped', () => {
    expect(classifyShape('Next.js')).toBe('shaped')
    expect(classifyShape('max.poll.records')).toBe('shaped')
    expect(classifyShape('last_referenced_at')).toBe('shaped')
    expect(classifyShape('Kafka')).toBe('shaped')
  })
  it('treats a bare lowercase single word as bare', () => {
    expect(classifyShape('weather')).toBe('bare')
    expect(classifyShape('thing')).toBe('bare')
  })
})
