import { describe, expect, it } from 'vitest'
import {
  MAX_MESSAGE_CHARS,
  MAX_REQUESTS,
  MAX_REQUEST_CHARS,
  WINDOW_MS,
  allowance,
  checkMessage,
  memoryBudget,
  prune,
  record,
} from '@/lib/rate-limit'

/** A window's worth of requests, all made at `now`. */
function full(now: number): number[] {
  return Array.from({ length: MAX_REQUESTS }, () => now)
}

describe('allowance', () => {
  const T = 1_000_000

  it('lets the first request through and counts down from there', () => {
    expect(allowance([], T)).toEqual({
      allowed: true,
      remaining: MAX_REQUESTS - 1,
      resetInMs: 0,
    })
  })

  it('reports what is left after some of the window is spent', () => {
    const hits = [T - 5_000, T - 4_000, T - 3_000]

    expect(allowance(hits, T).remaining).toBe(MAX_REQUESTS - 4)
  })

  it('says when a slot returns even while there are slots to spare', () => {
    // The number matters most BEFORE anyone runs out: it is what lets a
    // visitor decide whether to ask the long question now or wait. Reporting
    // it only once the window is full withholds it at exactly the moment it
    // would have been useful.
    const hits = [T - 50_000, T - 1_000]
    const v = allowance(hits, T)

    expect(v.allowed).toBe(true)
    expect(v.resetInMs).toBe(10_000)
  })

  it('reports no wait when nothing has been spent', () => {
    expect(allowance([], T).resetInMs).toBe(0)
  })

  it('refuses the request past the cap', () => {
    const v = allowance(full(T), T)

    expect(v.allowed).toBe(false)
    expect(v.remaining).toBe(0)
  })

  it('says how long until one more fits, measured from the OLDEST request', () => {
    // The window slides, so nothing resets all at once. The first slot to
    // free is the oldest one, a full window after it was taken — reporting
    // the newest instead would tell someone to wait a minute when they
    // could go in two seconds.
    const hits = [T - 58_000, ...Array.from({ length: MAX_REQUESTS - 1 }, () => T)]

    expect(allowance(hits, T).resetInMs).toBe(2_000)
  })

  it('forgets a request once the window has passed it', () => {
    const v = allowance(full(T), T + WINDOW_MS + 1)

    expect(v.allowed).toBe(true)
    expect(v.remaining).toBe(MAX_REQUESTS - 1)
  })

  it('opens exactly when it said it would, not a millisecond later', () => {
    // The window's far edge is exclusive: a request made at T has aged out
    // AT T + WINDOW_MS, not after it. This matters because `resetInMs`
    // promises that instant — an off-by-one here would have the gauge count
    // down to zero and then refuse the next request anyway, which reads as
    // the product lying rather than as a boundary being awkward.
    expect(allowance(full(T), T + WINDOW_MS - 1).allowed).toBe(false)
    expect(allowance(full(T), T + WINDOW_MS).allowed).toBe(true)

    expect(allowance(full(T), T).resetInMs).toBe(WINDOW_MS)
  })

  it('never reports a negative wait when the clock moves backwards', () => {
    // NTP corrections and laptops waking from sleep both do this. A negative
    // wait renders as "resets in -4s", which reads as a bug in the product
    // rather than a bug in the clock.
    expect(allowance(full(T), T - 30_000).resetInMs).toBeGreaterThanOrEqual(0)
  })

  it('survives a burst that arrives within the same millisecond', () => {
    const v = allowance(full(T), T)

    expect(v.allowed).toBe(false)
    expect(v.resetInMs).toBe(WINDOW_MS)
  })
})

describe('record and prune', () => {
  const T = 2_000_000

  it('charges exactly one slot', () => {
    expect(record([T - 1_000], T)).toHaveLength(2)
  })

  it('drops expired timestamps as it records, so the list cannot grow forever', () => {
    const stale = Array.from({ length: 50 }, (_, i) => T - WINDOW_MS - i * 1_000)

    expect(record(stale, T)).toEqual([T])
  })

  it('keeps a timestamp exactly on the boundary out', () => {
    expect(prune([T - WINDOW_MS], T)).toEqual([])
    expect(prune([T - WINDOW_MS + 1], T)).toHaveLength(1)
  })
})

describe('checkMessage', () => {
  it('accepts a message at the cap', () => {
    expect(checkMessage('x'.repeat(MAX_MESSAGE_CHARS)).ok).toBe(true)
  })

  it('refuses one character past it', () => {
    expect(checkMessage('x'.repeat(MAX_MESSAGE_CHARS + 1)).ok).toBe(false)
  })

  it('names the actual length and the limit, not just "too long"', () => {
    // Standing rule: never fail blankly. Without both numbers the visitor
    // cannot tell whether to cut a sentence or a page.
    const v = checkMessage('x'.repeat(2_500))

    expect(v.ok).toBe(false)
    expect(v.ok === false && v.reason).toContain('2,500')
    expect(v.ok === false && v.reason).toContain('2,000')
  })
})

describe('memoryBudget', () => {
  it('gives the rest of the request budget to memory', () => {
    expect(memoryBudget(1_000)).toBe(MAX_REQUEST_CHARS - 1_000)
  })

  it('returns zero rather than a negative budget for a long message', () => {
    // A negative budget reaches retrieveContext's `used + length > budget`
    // check and drops every chat, which is the right outcome — but by
    // accident. Returning zero makes it the stated one.
    expect(memoryBudget(MAX_REQUEST_CHARS + 500)).toBe(0)
  })

  it('leaves room for memory at the message cap, so a long message still gets context', () => {
    // If the two caps were equal, every maximum-length message would answer
    // from its own conversation alone. They are not, and this is the test
    // that fails if someone later "simplifies" them to one number.
    expect(memoryBudget(MAX_MESSAGE_CHARS)).toBeGreaterThan(0)
  })
})
