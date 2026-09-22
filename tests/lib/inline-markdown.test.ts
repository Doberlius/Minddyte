import { describe, it, expect } from 'vitest'
import { splitInline } from '@/lib/inline-markdown'

/**
 * A Compaction stores what was said, byte for byte, and a model says a lot of
 * it in markdown. Rendered raw, a memory reads `**parallelize** the writing`
 * and looks like a bug in the panel whose whole claim is that these are real
 * sentences.
 *
 * So the STORED sentence stays untouched and only its DISPLAY drops the
 * syntax. The words are the same words — that is the line this must not
 * cross, and why every test below checks that the text survives.
 */

const text = (parts: { text: string }[]) => parts.map((p) => p.text).join('')

describe('splitInline', () => {
  it('leaves a plain sentence in one piece', () => {
    expect(splitInline('Kafka partitions handle ordering.')).toEqual([
      { text: 'Kafka partitions handle ordering.' },
    ])
  })

  it('marks bold and drops its asterisks', () => {
    const parts = splitInline('they allow you to **parallelize** the writing')

    expect(text(parts)).toBe('they allow you to parallelize the writing')
    expect(parts.find((p) => p.bold)?.text).toBe('parallelize')
  })

  it('marks italic', () => {
    const parts = splitInline('ordering is *local* to the partition')

    expect(text(parts)).toBe('ordering is local to the partition')
    expect(parts.find((p) => p.italic)?.text).toBe('local')
  })

  it('marks code', () => {
    const parts = splitInline('set `max.poll.records` lower')

    expect(text(parts)).toBe('set max.poll.records lower')
    expect(parts.find((p) => p.code)?.text).toBe('max.poll.records')
  })

  it('handles several spans in one sentence', () => {
    const parts = splitInline('**A** and **B** are both `set`')

    expect(text(parts)).toBe('A and B are both set')
    expect(parts.filter((p) => p.bold).map((p) => p.text)).toEqual(['A', 'B'])
    expect(parts.filter((p) => p.code).map((p) => p.text)).toEqual(['set'])
  })

  it('strips a leading heading marker, which is not part of the sentence', () => {
    expect(text(splitInline('### Why Postgres wins'))).toBe('Why Postgres wins')
  })

  it('strips a leading list marker', () => {
    expect(text(splitInline('* Never UPDATE a balance row'))).toBe('Never UPDATE a balance row')
    expect(text(splitInline('- Never UPDATE a balance row'))).toBe('Never UPDATE a balance row')
  })

  it('leaves an unmatched marker alone rather than eating the rest', () => {
    // A sentence can be cut out of a longer message mid-emphasis. Dropping the
    // lone asterisk would be fine; swallowing everything after it would not.
    expect(text(splitInline('a lone ** asterisk stays put'))).toBe('a lone ** asterisk stays put')
  })

  it('does not treat arithmetic as emphasis', () => {
    expect(text(splitInline('2 * 3 * 4 is twenty-four'))).toBe('2 * 3 * 4 is twenty-four')
  })

  it('keeps text in other scripts intact', () => {
    const parts = splitInline('**LLM คือ "สมอง"** ระบบของ Jev')

    expect(text(parts)).toBe('LLM คือ "สมอง" ระบบของ Jev')
    expect(parts.find((p) => p.bold)?.text).toBe('LLM คือ "สมอง"')
  })

  it('returns nothing for an empty string', () => {
    expect(splitInline('')).toEqual([])
  })

  it('strips a heading marker that survived mid-sentence', () => {
    // splitSentences cuts on terminators, so a heading further down a reply
    // arrives glued to the end of the sentence before it. Seen on the real
    // archive: "...with the Mindset and Grill with Docs: ### 1."
    expect(text(splitInline('fits into the ecosystem: ### 1.'))).toBe('fits into the ecosystem: 1.')
  })

  it('strips a horizontal rule wherever it landed', () => {
    expect(text(splitInline('in this business --- ### 1.'))).toBe('in this business 1.')
    expect(text(splitInline('done ***'))).toBe('done')
  })

  it('keeps a dash that is punctuation, not a rule', () => {
    expect(text(splitInline('Postgres — not DynamoDB'))).toBe('Postgres — not DynamoDB')
    expect(text(splitInline('a well-known trade-off'))).toBe('a well-known trade-off')
  })

  it('leaves a lone hash that is not a marker', () => {
    expect(text(splitInline('issue #42 is open'))).toBe('issue #42 is open')
  })
})
