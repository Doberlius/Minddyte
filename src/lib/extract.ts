import nlp from 'compromise'
import { classifyShape } from './text'
import { PROVISIONAL } from './provisional'
import { chunkSpan } from './pointers'

/**
 * Deterministic concept extraction. Spec §4.2.
 *
 * One grammar pattern, no statistical ranking — measured, TF-IDF and RAKE are
 * unusable with a single short message and no corpus.
 *
 * NEVER call compromise's .compute('id'), .insert() or .random() — those are
 * the only paths in the library that touch Math.random.
 */
const PATTERN = '#Adjective? #Noun+ #Gerund?'

// The plain View compromise hands to forEach, not the full document type.
type Match = Parameters<Parameters<ReturnType<typeof nlp>['forEach']>[0]>[0]

/**
 * "Set max.poll.records carefully." matched as ONE phrase: capitalised and
 * sentence-initial, "Set" is tagged Noun, so `#Noun+` runs straight into its
 * object and the key `setmaxpollrecords` can never match anything. Measured
 * (ticket 12): the swallowed word is tagged Noun, never Verb, so `.not('#Verb')`
 * cannot catch it, and which verbs get swallowed is unpredictable ("Refactor"
 * is, "Deploy" is not), so a blocklist cannot either.
 *
 * The first word is dropped only when ALL of these hold:
 *  - it opens its sentence, the only position where the bug occurs;
 *  - the phrase has another word to keep;
 *  - read alone and lowercased, compromise calls it a base verb ("set" yes,
 *    "kafka" no, "streaming" is a Gerund so "event streaming" is safe);
 *  - the sentence has no other real verb. An imperative's verb IS the first
 *    word, while a statement has its own verb elsewhere: this keeps
 *    "Index size grows fast." and "Set theory is fun." intact. Gerunds do not
 *    count; they never make a sentence a statement.
 */
function withoutLeadingVerb(m: Match): Match {
  const opensSentence = m.pointer?.[0]?.[1] === 0
  if (!opensSentence || m.terms().length < 2) return m
  const first = m.terms().first()
  if (!nlp(first.text('normal')).has('#Infinitive')) return m
  if (m.fullSentences().match('#Verb').not('#Gerund').found) return m
  return m.not(first)
}

export function extractConcepts(text: string): { auto: string[]; suggested: string[] } {
  // Ticket 15, Q7: read at most extractCharLimit characters, cut at whitespace.
  const head =
    text.length > PROVISIONAL.extractCharLimit
      ? text.slice(0, chunkSpan(text, 0, text.length, PROVISIONAL.extractCharLimit)[0][1])
      : text
  const doc = nlp(head)
  // compromise tags pronouns as nouns, so `#Noun+` swallows "I", "me" and
  // "We". They are never concepts, and the shape gate cannot catch them:
  // "I" and "We" carry an uppercase letter, so classifyShape reads them as
  // "shaped" and auto-creates a Node. Measured on real messages — "Remind me
  // what I concluded about event streaming" yielded Nodes for both "me" and
  // "I". Dropping pronoun tokens leaves every real concept untouched and
  // reduces "chat I" to "chat", which then falls to `bare` and is only
  // suggested. Spec §4.2.
  const raw: string[] = []
  doc.match(PATTERN).forEach((m: Match) => {
    raw.push(...withoutLeadingVerb(m).not('#Pronoun').out('array'))
  })

  const auto: string[] = []
  const suggested: string[] = []
  const seen = new Set<string>()

  for (const phraseRaw of raw) {
    // `#Noun+` runs straight across a comma, so "the custodian agency system,
    // data gaps" arrived as ONE phrase. The trailing-punctuation strip below
    // is anchored to the end (`$`), so an internal comma survived into the
    // canonical key — `custodianagencysystemdatagaps`, which can never match
    // anything in another Chat. Splitting here recovers both concepts.
    // Measured most often on tool lists: "PostgreSQL, Redis, and Kafka" became
    // the dead key `postgresqlredis`. A comma separating a CLAUSE is unaffected,
    // because compromise already ends the noun run there.
    for (const part of phraseRaw.split(',')) {
      const phrase = part.trim().replace(/[.,;:!?]+$/, '')
      if (!phrase) continue
      // Ticket 15, Q8: a phrase longer than a sentence is never a concept.
      if (phrase.length > PROVISIONAL.conceptMaxChars || phrase.split(/\s+/).length > PROVISIONAL.conceptMaxWords) continue
      const dedupe = phrase.toLowerCase()
      if (seen.has(dedupe)) continue
      seen.add(dedupe)

      if (classifyShape(phrase) === 'bare') suggested.push(phrase)
      else auto.push(phrase)
    }
  }
  return { auto, suggested }
}
