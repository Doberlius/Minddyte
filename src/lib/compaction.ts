import { splitSentences } from './text'

/** Spec §4.1 — 400–600 characters, ~100–150 tokens. */
export const COMPACTION_CAP = 500

/**
 * ASCII record separator. Sentences are joined with this rather than a space
 * or newline because appendToCompaction has to recover sentence boundaries
 * from the stored string, and any separator that can occur INSIDE a sentence
 * (a space, a newline in pasted text) makes that impossible. It cannot appear
 * in typed text, so boundaries stay unambiguous without altering content.
 */
export const RECORD_SEPARATOR = String.fromCharCode(0x1e) // ASCII record separator (RS)

/**
 * Join the sentences that FIT, in order, until the cap is reached.
 *
 * Sentences are kept verbatim — never rewritten or whitespace-normalized.
 * Joins with RECORD_SEPARATOR so the boundary stays unambiguous: unlike a
 * space or a newline, that character cannot occur inside a sentence, so
 * appendToCompaction can always split it back apart correctly, even for a
 * pasted code block that contains newlines and indentation.
 *
 * This used to `break` on the first sentence that did not fit, which read as
 * "drop whole ones from the tail" and is wrong in two ways that were measured:
 *
 *   1. It DESTROYED existing memory. appendToCompaction queues the new
 *      message's sentences ahead of the accumulated ones, so a single
 *      oversized message stopped the loop before any older sentence was even
 *      considered — one 611-character message wiped a chat's whole Compaction,
 *      silently. That is the standing rule against destroying data silently.
 *   2. It discarded shorter sentences that fit. Measured on a real reply: 30
 *      sentences, only 2 over cap, and still just 3 kept.
 *
 * `continue` skips what cannot fit and keeps looking. The result is no longer a
 * contiguous prefix, but it is still in order, still whole sentences, and still
 * verbatim. Both callers use this function, so the incremental-versus-rebuild
 * invariant holds automatically.
 *
 * It does NOT fix the case where no sentence fits at all — a first message
 * whose every sentence is over cap still yields "". Surfacing that to the user
 * is a separate obligation; see ticket 11.
 */
function trim(sentences: string[], cap: number): string {
  const kept: string[] = []
  let len = 0
  for (const s of sentences) {
    if (!s) continue
    const add = kept.length ? s.length + 1 : s.length
    if (len + add > cap) continue
    kept.push(s)
    len += add
  }
  return kept.join(RECORD_SEPARATOR)
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
  const existing = current.split(RECORD_SEPARATOR).filter(Boolean)
  return trim([...incoming, ...existing], cap)
}

/**
 * One exchange: what the user said, and what the assistant replied.
 *
 * `assistant` is optional because a turn exists from the moment the user
 * sends — the reply has not streamed yet, and a chat whose last reply failed
 * still has a valid final turn.
 */
export type Turn = {
  user: string
  assistant?: string
}

/**
 * Full rebuild from scratch. Only called when Forgetting invalidates the
 * cached compaction (spec §5.1) — that is the one event that changes what
 * older messages contribute.
 *
 * `turns` must be ordered OLDEST FIRST; this reverses them so the newest
 * turn leads, matching the incremental path. Spec §4.1 takes BOTH roles,
 * "the user's messages weighted first" — so within a turn the user's
 * sentences come before the assistant's, and therefore survive trimming
 * longer.
 *
 * The incremental path reproduces this by appending the assistant's reply
 * first and the user's message second, since appendToCompaction PREPENDS:
 *
 *     appendToCompaction(appendToCompaction(current, assistant), user)
 *
 * The equality of these two functions (incremental vs rebuild) is asserted
 * by the invariant test and must never be broken. It holds because trim
 * joins with RECORD_SEPARATOR, a character that cannot occur inside a
 * sentence, so appendToCompaction can always recover sentences by splitting
 * on it.
 */
export function buildCompaction(turns: Turn[], cap = COMPACTION_CAP): string {
  const sentences = [...turns]
    .reverse()
    .flatMap((t) => [
      ...splitSentences(t.user),
      ...(t.assistant ? splitSentences(t.assistant) : []),
    ])
  return trim(sentences, cap)
}
