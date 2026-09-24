import nlp from 'compromise'
import { extractConcepts } from './extract'
import { PROVISIONAL } from './provisional'

/**
 * The part of a draft that text search reads: its first
 * PROVISIONAL.queryCharLimit code points, trimmed. Code points, not UTF-16
 * units — `.slice` could cut an emoji in half and hand Postgres a lone
 * surrogate. Walks only the prefix, so an 824,000-char paste costs 500 steps.
 */
export function queryText(draft: string): string {
  let end = 0
  let points = 0
  for (const ch of draft) {
    if (points === PROVISIONAL.queryCharLimit) break
    end += ch.length
    points++
  }
  return draft.slice(0, end).trim()
}

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
 * A closed set of possessive determiners, matched as a whole leading word.
 * "Kafka's" and "PostgreSQL's" are NOT in this set — see the comment on
 * `stripLeadingPossessive` for why that distinction matters.
 */
const LEADING_POSSESSIVE = /^(my|our|your|his|her|its|their)\s+/i

/**
 * Strips a single leading possessive determiner ("our", "my", ...) from a
 * phrase before it is scored or returned, e.g. "our retention period" ->
 * "retention period", "Kafka's partitions" -> unchanged.
 *
 * Why this exists: compromise tags "our" as a possessive NOUN, not a
 * Pronoun, so extract.ts's `.not('#Pronoun')` filter does not exclude it,
 * and extractConcepts keeps "our retention period" whole. Measured:
 * strict_word_similarity('our retention period', 'The retention period for
 * audit logs is ninety days by default.') = 0.81 — below
 * PROVISIONAL.strongStrictSimilarity (0.9) — so a chat that genuinely says
 * "retention period" verbatim never earns the strong-text promotion this
 * phrase exists to trigger.
 *
 * Why it is NOT fixed in extract.ts: the same Possessive tag also marks a
 * proper-noun possessive — "Kafka's partitions", "PostgreSQL's connection
 * pool" — and excluding the whole tag there drops the concept's own noun.
 * Measured on this worktree: extractConcepts("Kafka's partitions keep
 * order.").auto goes from `["Kafka's partitions"]` to `[]` — the concept is
 * gone entirely, not just trimmed. extract.ts is also outside this task's
 * file list, and the spec requires re-measuring extraction precision (§4.2)
 * before any change to it. So this strips ONLY the closed set of pronoun-like
 * possessive determiners, here, in search-only code, and leaves a
 * proper-noun's possessive alone.
 *
 * The extraction defect itself is still open: extractConcepts (and therefore
 * Node creation) still turns "our retention period" into a Node verbatim.
 * This function only keeps that leftover "our" from blocking a search-time
 * text match — it does not touch what gets written to the graph.
 */
function stripLeadingPossessive(phrase: string): string {
  return phrase.replace(LEADING_POSSESSIVE, '')
}

/**
 * The phrases in a draft that could earn the strong-text tier: its own
 * extracted concepts (auto and suggested), multi-word ones only.
 */
export function strongPhrases(draft: string): string[] {
  const { auto, suggested } = extractConcepts(draft)
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of [...auto, ...suggested]) {
    const p = stripLeadingPossessive(raw)
    const key = p.toLowerCase()
    if (seen.has(key) || significantTokenCount(p) < STRONG_MIN_SIGNIFICANT_TOKENS) continue
    seen.add(key)
    out.push(p)
  }
  return out
}
