import nlp from 'compromise'
import { classifyShape } from './text'

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

export function extractConcepts(text: string): { auto: string[]; suggested: string[] } {
  const doc = nlp(text)
  // compromise tags pronouns as nouns, so `#Noun+` swallows "I", "me" and
  // "We". They are never concepts, and the shape gate cannot catch them:
  // "I" and "We" carry an uppercase letter, so classifyShape reads them as
  // "shaped" and auto-creates a Node. Measured on real messages — "Remind me
  // what I concluded about event streaming" yielded Nodes for both "me" and
  // "I". Dropping pronoun tokens leaves every real concept untouched and
  // reduces "chat I" to "chat", which then falls to `bare` and is only
  // suggested. Spec §4.2.
  const raw: string[] = doc.match(PATTERN).not('#Pronoun').out('array')

  const auto: string[] = []
  const suggested: string[] = []
  const seen = new Set<string>()

  for (const phraseRaw of raw) {
    const phrase = phraseRaw.trim().replace(/[.,;:!?]+$/, '')
    if (!phrase) continue
    const dedupe = phrase.toLowerCase()
    if (seen.has(dedupe)) continue
    seen.add(dedupe)

    if (classifyShape(phrase) === 'bare') suggested.push(phrase)
    else auto.push(phrase)
  }
  return { auto, suggested }
}
