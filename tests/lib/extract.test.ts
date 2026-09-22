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

describe('pronouns are never concepts', () => {
  it('drops standalone pronouns instead of admitting them as nodes', () => {
    // "I" and "We" carry an uppercase letter, so without this the shape gate
    // reads them as `shaped` and auto-creates a Node for a pronoun.
    const r = extractConcepts('Remind me what I concluded about event streaming.')
    expect(r.auto).toContain('event streaming')
    for (const p of [...r.auto, ...r.suggested]) {
      expect(['i', 'me', 'we', 'you', 'it', 'they']).not.toContain(p.toLowerCase())
    }
  })

  it('strips a trailing pronoun from a phrase rather than keeping it', () => {
    const r = extractConcepts('what topic was the chat I tagged about?')
    expect([...r.auto, ...r.suggested]).not.toContain('chat I')
    expect(r.auto).not.toContain('chat')
  })

})

describe('a comma inside a matched phrase', () => {
  // An internal comma survived into the canonical key, because punctuation was
  // stripped only from the END of a matched phrase (`/[.,;:!?]+$/`). Two concepts
  // fused into one Node whose key could never match anything in another Chat.
  it('splits a matched phrase on an internal comma rather than fusing two concepts', () => {
    const r = extractConcepts('I use PostgreSQL, Redis, and Kafka for this project.')
    expect(r.auto).toContain('PostgreSQL')
    expect(r.auto).toContain('Redis')
    expect(r.auto).not.toContain('PostgreSQL, Redis')
  })

  it('recovers both concepts from a comma-separated noun run', () => {
    const r = extractConcepts(
      'Explain the custodian agency system, data gaps in developing countries, and the tier classification.',
    )
    expect(r.auto).toContain('custodian agency system')
    expect(r.auto).toContain('data gaps')
  })

  it('leaves a clause-separating comma alone', () => {
    const r = extractConcepts('After the migration, the retrieval query got faster.')
    expect(r.auto).toContain('retrieval query')
  })
})
