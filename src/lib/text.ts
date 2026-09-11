/**
 * Pure string primitives. No database, no model, no I/O.
 * Everything here must be deterministic: same input, same output, forever.
 */

/** A Node's identity within one user's graph. Spec §4.3. */
export function canonicalKey(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/**
 * Split text into sentences, verbatim. Never rewrites.
 * A terminator only ends a sentence when followed by whitespace and an
 * uppercase letter, so `max.poll.records` and `3.5` stay intact.
 */
export function splitSentences(text: string): string[] {
  const t = text.trim()
  if (!t) return []
  return t
    .split(/(?<=[.!?])\s+(?=[A-Z])/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/**
 * Admission gate. Spec §4.2 — measured precision by shape:
 *   multi  87%  → auto-create
 *   shaped 100% → auto-create
 *   bare   29%  → suggest only
 *
 * "Shape" means the word is not plain lowercase letters: it contains an
 * uppercase letter, a digit, a dot, or an underscore.
 */
export function classifyShape(label: string): 'multi' | 'shaped' | 'bare' {
  const t = label.trim()
  if (/\s/.test(t)) return 'multi'
  return /[A-Z0-9._]/.test(t) ? 'shaped' : 'bare'
}

const LEADING_QUESTION_WORDS =
  /^(how|what|why|when|where|which|who|does|do|did|is|are|can|could|should|would|will)\s+/i

/**
 * A Chat's title, from its first user message. Spec 4.4 / decision 16.
 * Set once; renaming a Chat never re-runs this.
 */
export function deriveTitle(firstMessage: string): string {
  let t = firstMessage.trim().replace(/\s+/g, ' ')
  if (!t) return 'New Session'
  while (LEADING_QUESTION_WORDS.test(t)) t = t.replace(LEADING_QUESTION_WORDS, '')
  t = t.replace(/[?.!,;:]+$/, '').trim()
  if (!t) return 'New Session'
  if (t.length > 60) t = t.slice(0, 60).replace(/\s+\S*$/, '')
  return t.charAt(0).toUpperCase() + t.slice(1)
}
