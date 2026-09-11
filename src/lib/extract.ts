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
  const raw: string[] = doc.match(PATTERN).out('array')

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
