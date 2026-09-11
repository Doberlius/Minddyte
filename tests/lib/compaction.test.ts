import { describe, it, expect } from 'vitest'
import { appendToCompaction, buildCompaction } from '@/lib/compaction'

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
    for (const s of out.split(/(?<=\.)\s+/).filter(Boolean)) {
      expect(s.endsWith('.')).toBe(true)
    }
  })

  it('returns the existing compaction unchanged when the message has no sentences', () => {
    expect(appendToCompaction('Existing.', '   ', CAP)).toBe('Existing.')
  })
})

describe('the incremental invariant', () => {
  it('N incremental appends equal one full rebuild', () => {
    const msgs = [
      'First message about Kafka.',
      'Second message about backpressure.',
      'Third message about consumer groups.',
      'Fourth message about timeouts.',
    ]
    const incremental = msgs.reduce((acc, m) => appendToCompaction(acc, m, CAP), '')
    const full = buildCompaction(msgs, CAP)
    expect(incremental).toBe(full)
  })

  it('holds when a message has no terminal punctuation', () => {
    const msgs = ['X'.repeat(40) + '.', 'Y'.repeat(40), 'Z'.repeat(40) + '.']
    const incremental = msgs.reduce((acc, m) => appendToCompaction(acc, m, 90), '')
    expect(incremental).toBe(buildCompaction(msgs, 90))
  })
})
