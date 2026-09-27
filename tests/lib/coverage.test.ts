import { describe, expect, it } from 'vitest'
import { coverageReach } from '@/lib/coverage'

const m = (o: Record<string, string[]>) => new Map(Object.entries(o).map(([w, ids]) => [w, new Set(ids)]))

describe('coverageReach', () => {
  it('reaches a chat that holds the rare words of the draft', () => {
    // 30 other chats: "database" is in 25 of them (weighs little), "journal" only in X (weighs a lot).
    const common = Array.from({ length: 25 }, (_, i) => `c${i}`)
    const got = coverageReach(['database', 'journal'], m({ database: [...common, 'X'], journal: ['X'] }), 30)
    expect([...got.keys()]).toEqual(['X'])
    expect(got.get('X')!.coverage).toBeCloseTo(1, 5)
    expect(got.get('X')!.words).toEqual(['database', 'journal'])
  })

  it('does not reach through common words alone', () => {
    const common = Array.from({ length: 25 }, (_, i) => `c${i}`)
    const got = coverageReach(['database', 'journal'], m({ database: common, journal: [] }), 30)
    expect(got.size).toBe(0)
  })

  it('a word in no chat weighs the most, so a draft about it reaches nothing', () => {
    // X holds two words, so the 2-word rule is met: only the weights keep it out.
    // n = 28: "story" and "plot" are in 10 chats each, idf ln(29/10.5) = 1.016;
    // "hamlet" and "ophelia" are in none, idf ln(29/0.5) = 4.060.
    // Coverage of X = 2.032 / 10.152 = 0.20 < 0.4.
    const ten = (x: string) => [x, ...Array.from({ length: 9 }, (_, i) => `o${i}`)]
    const got = coverageReach(['story', 'plot', 'hamlet', 'ophelia'], m({ story: ten('X'), plot: ten('X') }), 28)
    expect(got.has('X')).toBe(false)
  })

  it('needs at least two matching words when the draft has two or more', () => {
    // "water" is only in X and "drink" only in Y: each holds half the weight
    // (coverage 0.5 >= 0.4), yet one stray word is not enough to reach.
    const got = coverageReach(['water', 'drink'], m({ water: ['X'], drink: ['Y'] }), 28)
    expect(got.size).toBe(0)
  })

  it('a one-word draft reaches with its one word', () => {
    const got = coverageReach(['ddg'], m({ ddg: ['X'] }), 28)
    expect(got.get('X')).toEqual({ coverage: 1, words: ['ddg'] })
  })

  // Decision 1: weights are computed as if there were at least 20 other chats.
  // Without it, one other chat makes a missing word weigh ~5x a present one.
  it('smooths weights in a tiny workspace', () => {
    const got = coverageReach(['ninety', 'days', 'sounds', 'right'], m({ ninety: ['X'], days: ['X'] }), 1)
    // idf present = ln(21/1.5) = 2.639; idf absent = ln(21/0.5) = 3.738; 2*2.639 / (2*2.639 + 2*3.738) = 0.4138
    expect(got.get('X')!.coverage).toBeCloseTo(0.4138, 3)
    expect(got.get('X')!.words).toEqual(['ninety', 'days'])
  })

  it('returns nothing for no words', () => {
    expect(coverageReach([], new Map(), 10).size).toBe(0)
  })
})
