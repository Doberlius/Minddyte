import nlp from 'compromise'
import { extractConcepts } from './extract'

/**
 * Closed word classes: English does not invent new determiners, pronouns,
 * prepositions or conjunctions, so this list never needs maintaining.
 * Ticket 05, Q4 — researched in docs/research/2026-09-23-deterministic-pos-tagger.md:
 * compromise is the only candidate that keeps `max.poll.records` whole and is
 * stable across Bun and Node, and it is already extraction's grammar, so there
 * is one source of truth about grammar, not two.
 */
const CLOSED_TAGS = ['Determiner', 'Pronoun', 'Preposition', 'Conjunction'] as const

/**
 * be / do / have, every form. compromise tags "do" in "how long do we keep"
 * as a main verb, so the tag alone does not exclude it (Q4b). Also closed.
 */
const AUXILIARY_FORMS = new Set([
  'be', 'am', 'is', 'are', 'was', 'were', 'been', 'being',
  'do', 'does', 'did', 'doing', 'done',
  'have', 'has', 'had', 'having',
])

/** A promotion needs a match on at least this many significant tokens. "system" alone never promotes. */
export const STRONG_MIN_SIGNIFICANT_TOKENS = 2

type Term = { text: string; normal?: string; tags: string[] }

export function significantTokenCount(phrase: string): number {
  const terms = (nlp(phrase).json() as { terms: Term[] }[]).flatMap((s) => s.terms)
  return terms.filter(
    (t) =>
      !CLOSED_TAGS.some((c) => t.tags.includes(c)) &&
      !AUXILIARY_FORMS.has((t.normal ?? t.text).toLowerCase()) &&
      /[a-z0-9]/i.test(t.text),
  ).length
}

/**
 * The phrases in a draft that could earn the strong-text tier: its own
 * extracted concepts (auto and suggested), multi-word ones only.
 */
export function strongPhrases(draft: string): string[] {
  const { auto, suggested } = extractConcepts(draft)
  const seen = new Set<string>()
  const out: string[] = []
  for (const p of [...auto, ...suggested]) {
    const key = p.toLowerCase()
    if (seen.has(key) || significantTokenCount(p) < STRONG_MIN_SIGNIFICANT_TOKENS) continue
    seen.add(key)
    out.push(p)
  }
  return out
}
