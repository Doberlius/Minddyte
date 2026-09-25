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

describe('a sentence-initial verb before its object', () => {
  // "Set max.poll.records carefully." matched as ONE phrase, "Set max.poll.records",
  // because compromise tags a capitalised sentence-initial "Set" as a Noun. Its
  // key `setmaxpollrecords` can never match the identifier written any other way.
  it('drops the leading verb and keeps the identifier', () => {
    const r = extractConcepts('Set max.poll.records carefully.')
    expect([...r.auto, ...r.suggested]).toContain('max.poll.records')
    expect([...r.auto, ...r.suggested]).not.toContain('Set max.poll.records')
  })

  it('drops a leading verb that is not also a noun', () => {
    // "Refactor" is not a noun, yet it is swallowed; "Deploy" is not. Which
    // words trigger it is unpredictable, so this is not a blocklist.
    const r = extractConcepts('Refactor retrieval.ts today.')
    expect([...r.auto, ...r.suggested]).toContain('retrieval.ts')
    expect([...r.auto, ...r.suggested]).not.toContain('Refactor retrieval.ts')
  })

  it('keeps a gerund inside the phrase', () => {
    // PATTERN ends in #Gerund?, and gerunds are verb-tagged. A blanket verb
    // filter would cut "event streaming" down to "event".
    const r = extractConcepts('The event streaming pipeline handles backpressure.')
    expect(r.auto).toContain('event streaming')
  })

  it('leaves imperatives with a determiner, and verbs compromise already tags, clean', () => {
    const verbs = [
      'Set', 'Run', 'Check', 'Order', 'Plan', 'Report', 'Record', 'Match', 'Use',
      'Explain', 'Describe', 'Refactor', 'Investigate', 'Summarize',
    ]
    for (const v of verbs) {
      expect(extractConcepts(`${v} the retrieval query.`).auto).toEqual(['retrieval query'])
    }
  })

  it('keeps a statement whose first word could be a verb', () => {
    // A statement has its own verb ("grows", "is"), so its first word is the
    // subject, not a command. Only a sentence with no other verb is imperative.
    expect(extractConcepts('Index size grows fast.').auto).toContain('Index size')
    expect(extractConcepts('Set theory is fun.').auto).toContain('Set theory')
  })

  it('gives byte-identical output on a re-run', () => {
    const input = 'Set max.poll.records carefully. Refactor retrieval.ts today.'
    expect(JSON.stringify(extractConcepts(input)))
      .toBe(JSON.stringify(extractConcepts(input)))
  })
})
