import { describe, it, expect } from 'vitest'
import { significantTokenCount, strongPhrases } from '@/lib/tokens'

describe('significantTokenCount', () => {
  it.each([
    ['the system', 1],
    ['retention period', 2],
    ['ninety days', 2],
    ['audit logs', 2],
    ['password hashing', 2],
    ['Kafka partitions', 2],
    // compromise keeps a dotted identifier whole — ONE token, so it cannot
    // promote on its own. (Three other taggers split it into three.)
    ['max.poll.records', 1],
    ['the retention period of the logs', 3],
    ['a', 0],
  ])('%s -> %i', (phrase, n) => {
    expect(significantTokenCount(phrase)).toBe(n)
  })

  // compromise tags "do" here as a main verb; the fixed be/do/have list is
  // what excludes it (ticket 05, Q4b). "how" stays: QuestionWord was not
  // added to the closed list.
  it('does not count be/do/have forms', () => {
    expect(significantTokenCount('how long do we keep audit logs')).toBe(5)
    expect(significantTokenCount('is it done')).toBe(0)
  })
})

describe('strongPhrases', () => {
  it('keeps only concepts with at least two significant tokens', () => {
    const phrases = strongPhrases('How long is the retention period for audit logs on the system?')
    expect(phrases.map((p) => p.toLowerCase())).toContain('retention period')
    expect(phrases.every((p) => significantTokenCount(p) >= 2)).toBe(true)
  })

  it('returns nothing for a draft with no multi-word concept', () => {
    expect(strongPhrases('system?')).toEqual([])
  })
})
