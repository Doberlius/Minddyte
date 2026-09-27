import { describe, it, expect } from 'vitest'
import { queryText, significantTokenCount, strongPhrases, contentTokens } from '@/lib/tokens'
import { PROVISIONAL } from '@/lib/provisional'

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

  // Ticket 05 fix round 1: compromise tags "our" as a possessive NOUN, not a
  // Pronoun, so extractConcepts keeps "our retention period" whole and
  // strict_word_similarity('our retention period', <its own sentence>)
  // measured 0.81 — below the 0.9 promotion threshold. Stripping the leading
  // possessive determiner here (not in extract.ts — see tokens.ts's comment
  // on stripLeadingPossessive) fixes that without touching extraction.
  it('strips a leading possessive determiner before scoring', () => {
    expect(strongPhrases('What is our retention period?')).toEqual(['retention period'])
  })

  // The closed set (my/our/your/his/her/its/their) must NOT catch a
  // proper-noun possessive: measured extractConcepts("Kafka's partitions
  // keep order.").auto === ["Kafka's partitions"] — "Kafka's" is not in the
  // closed set, so the phrase, and its noun, survive whole.
  it('leaves a proper-noun possessive alone', () => {
    const phrases = strongPhrases("Kafka's partitions keep order.")
    expect(phrases.some((p) => p.toLowerCase().includes('kafka'))).toBe(true)
  })
})

describe('queryText', () => {
  it('keeps the first queryCharLimit code points and never splits a surrogate pair', () => {
    expect(PROVISIONAL.queryCharLimit).toBe(500)
    const out = queryText('🎉'.repeat(1000))
    expect(Array.from(out)).toHaveLength(500)
    expect(out).toBe('🎉'.repeat(500))
    // No lone surrogate anywhere (String.prototype.isWellFormed, spelled out).
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(out)).toBe(false)
  })

  it('returns a short draft unchanged, trimmed', () => {
    expect(queryText('  how long do we keep audit logs \n')).toBe('how long do we keep audit logs')
  })
})

describe('contentTokens', () => {
  it('drops filler and keeps the words that carry the question', () => {
    expect(contentTokens('What is the plot of Hamlet?')).toEqual(['plot', 'hamlet'])
    expect(contentTokens('How do I set up a Python virtual environment?')).toEqual(['python', 'virtual', 'environment'])
  })

  it('keeps identifiers whole', () => {
    // "2" is one character, so it is dropped.
    expect(contentTokens('min.insync.replicas=2')).toEqual(['min.insync.replicas'])
    expect(contentTokens('pg_stat_statements')).toEqual(['pg_stat_statements'])
    expect(contentTokens('enable.idempotence=true acks=all')).toEqual(['enable.idempotence', 'true', 'acks'])
  })

  it("drops a possessive 's, straight or curly", () => {
    expect(contentTokens("the database's journal")).toEqual(['database', 'journal'])
    expect(contentTokens('the UN\'s agenda')).toEqual(['un', 'agenda'])
  })

  it('returns nothing for a draft of filler only', () => {
    expect(contentTokens('what is it?')).toEqual([])
    expect(contentTokens('go on')).toEqual([])
    expect(contentTokens('')).toEqual([])
  })

  it('de-duplicates, keeping first-seen order', () => {
    expect(contentTokens('Kafka kafka KAFKA partitions')).toEqual(['kafka', 'partitions'])
  })

  // Review Focus 4 / Decision 2: letters are kept whole, not mangled. This is
  // NOT multi-language support — the filler list stays English.
  it('keeps non-Latin letters', () => {
    expect(contentTokens('Größe der Datenbank')).toEqual(['größe', 'der', 'datenbank'])
    expect(contentTokens('café crème')).toEqual(['café', 'crème'])
  })

  // Review Focus 5.
  it('caps the list at PROVISIONAL.reachMaxWords', () => {
    const draft = Array.from({ length: 100 }, (_, i) => `word${i}`).join(' ')
    const words = contentTokens(draft)
    expect(words).toHaveLength(PROVISIONAL.reachMaxWords)
    expect(words[0]).toBe('word0')
  })
})
