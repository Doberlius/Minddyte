import { splitSentences } from './text'

/** Spec §4.1 — 400–600 characters, ~100–150 tokens. */
export const COMPACTION_CAP = 500

/**
 * Join sentences and drop WHOLE ones from the tail until within cap.
 *
 * Normalizes internal whitespace (collapses runs to single spaces) so the
 * newline separator remains a structural record boundary — no sentence can
 * contain one. This is essential: appendToCompaction recovers sentences by
 * splitting on '\n', and a sentence with embedded newlines would fragment.
 * Without normalization, the invariant breaks for multi-line pasted messages
 * that lack a terminator before their newline.
 */
function trim(sentences: string[], cap: number): string {
  const kept: string[] = []
  let len = 0
  for (const s of sentences) {
    const normalized = s.replace(/\s+/g, ' ').trim()
    if (!normalized) continue
    const add = kept.length ? normalized.length + 1 : normalized.length
    if (len + add > cap) break
    kept.push(normalized)
    len += add
  }
  return kept.join('\n')
}

/**
 * Incremental append. Spec §4.1.
 *
 * Newest sentences go first; the tail falls off. Never re-reads the chat's
 * history — that would make compaction O(n²) over a chat's life.
 *
 * Sentences are dropped WHOLE. A truncated sentence can invert its meaning:
 * "We tried X first, but that made it worse" cut short becomes an endorsement.
 */
export function appendToCompaction(current: string, message: string, cap = COMPACTION_CAP): string {
  const incoming = splitSentences(message)
  if (incoming.length === 0) return current
  const existing = current.split('\n').filter(Boolean)
  return trim([...incoming, ...existing], cap)
}

/**
 * Full rebuild from scratch. Only called when Forgetting invalidates the
 * cached compaction (spec §5.1) — that is the one event that changes what
 * older messages contribute.
 *
 * `messages` must be ordered OLDEST FIRST; this reverses them so the newest
 * sentences lead, matching appendToCompaction. The equality of these two
 * functions (incremental vs rebuild) is asserted by the invariant test and
 * must never be broken. This equality holds because trim normalizes internal
 * whitespace and joins with newlines, ensuring the separator is unambiguous
 * and appendToCompaction can recover sentences via direct splitting.
 */
export function buildCompaction(messages: string[], cap = COMPACTION_CAP): string {
  const sentences = [...messages].reverse().flatMap((m) => splitSentences(m))
  return trim(sentences, cap)
}
