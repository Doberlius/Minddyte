import { describe, it, expect } from 'vitest'
import { appendToCompaction, buildCompaction, RECORD_SEPARATOR, type Turn } from '@/lib/compaction'

const CAP = 120

describe('appendToCompaction', () => {
  it('prepends the new message sentences ahead of older ones', () => {
    const out = appendToCompaction('Old thing happened.', 'New thing happened.', CAP)
    expect(out.indexOf('New thing')).toBeLessThan(out.indexOf('Old thing'))
  })

  it('keeps sentences verbatim — never rewrites', () => {
    const s = 'We tried max.poll.records=500 first, but that made the timeout worse.'
    expect(appendToCompaction('', s, 500)).toContain(s)
  })

  it('drops whole sentences from the tail, never truncating one', () => {
    const long = 'A'.repeat(60) + '. ' + 'B'.repeat(60) + '. ' + 'C'.repeat(60) + '.'
    const out = appendToCompaction('', long, CAP)
    expect(out.length).toBeLessThanOrEqual(CAP)
    // every retained sentence must be whole
    for (const s of out.split(RECORD_SEPARATOR).filter(Boolean)) {
      expect(s.endsWith('.')).toBe(true)
    }
  })

  // `trim` used `break`, so the first sentence that did not fit stopped the loop
  // entirely. Measured: one 611-character message wiped a chat's whole accumulated
  // memory, because the older sentences were queued BEHIND the oversized new one.
  it('a message too long to store never destroys what was already remembered', () => {
    const acc = appendToCompaction('', 'We chose Argon2 for password hashing.', CAP)
    const tooLong = 'A'.repeat(CAP + 50) + '.'
    expect(appendToCompaction(acc, tooLong, CAP)).toContain('Argon2')
  })

  // Measured on a real reply: 30 sentences, only 2 over cap, yet just 3 kept.
  it('one oversized sentence does not discard the shorter ones after it', () => {
    const msg = 'A'.repeat(CAP + 50) + '. Short one. Short two.'
    const out = appendToCompaction('', msg, CAP)
    expect(out).toContain('Short one.')
    expect(out).toContain('Short two.')
  })

  it('returns the existing compaction unchanged when the message has no sentences', () => {
    expect(appendToCompaction('Existing.', '   ', CAP)).toBe('Existing.')
  })
})

describe('the incremental invariant', () => {
  // The write path per turn: the assistant's reply is appended first and the
  // user's message second, because appendToCompaction prepends — leaving the
  // user's sentences leading. Spec §4.1.
  const ingestTurn = (acc: string, t: Turn, cap: number) =>
    appendToCompaction(t.assistant ? appendToCompaction(acc, t.assistant, cap) : acc, t.user, cap)

  it('N incremental appends equal one full rebuild', () => {
    const turns: Turn[] = [
      { user: 'First message about Kafka.' },
      { user: 'Second message about backpressure.' },
      { user: 'Third message about consumer groups.' },
      { user: 'Fourth message about timeouts.' },
    ]
    const incremental = turns.reduce((acc, t) => ingestTurn(acc, t, CAP), '')
    const full = buildCompaction(turns, CAP)
    expect(incremental).toBe(full)
  })

  it('holds when a message has no terminal punctuation', () => {
    const turns: Turn[] = [
      { user: 'X'.repeat(40) + '.' },
      { user: 'Y'.repeat(40) },
      { user: 'Z'.repeat(40) + '.' },
    ]
    const incremental = turns.reduce((acc, t) => ingestTurn(acc, t, 90), '')
    expect(incremental).toBe(buildCompaction(turns, 90))
  })

  it('holds when a message contains an embedded newline', () => {
    const turns: Turn[] = [{ user: 'AAAAA\nBBBBB.' }, { user: 'CCCCC.' }]
    const incremental = turns.reduce((acc, t) => ingestTurn(acc, t, 12), '')
    expect(incremental).toBe(buildCompaction(turns, 12))
  })

  it('holds when turns carry both roles', () => {
    const turns: Turn[] = [
      { user: 'First about Kafka.', assistant: 'Kafka is a distributed log.' },
      { user: 'Second about backpressure.', assistant: 'Backpressure throttles producers.' },
    ]
    const incremental = turns.reduce((acc, t) => ingestTurn(acc, t, 500), '')
    expect(incremental).toBe(buildCompaction(turns, 500))
  })

  it('puts the user ahead of the assistant within one turn', () => {
    // Spec §4.1 — "Both roles, the user's messages weighted first." Leading
    // means surviving the tail trim longest.
    const out = ingestTurn('', { user: 'User asked this.', assistant: 'Model answered that.' }, 500)
    expect(out.split(RECORD_SEPARATOR)).toEqual(['User asked this.', 'Model answered that.'])
  })

  it('keeps the assistant reply out of extraction but inside the compaction', () => {
    // A turn whose reply introduces a concept the user never raised: the
    // sentence is retrievable memory, but ingestUserMessage never passes it
    // to extractConcepts (asserted at the service layer, not here).
    const out = ingestTurn('', { user: 'Why is it slow?', assistant: 'Consumer lag was the cause.' }, 500)
    expect(out).toContain('Consumer lag was the cause.')
  })

  it('preserves a pasted code block byte-for-byte', () => {
    const code = 'def f(x):\n    if x:\n        return 1\n    return 0'
    expect(appendToCompaction('', code, 500)).toBe(code)
  })
})
