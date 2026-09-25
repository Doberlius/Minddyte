import { proseSpans, type ProseSpan } from './prose'
import { PROVISIONAL } from './provisional'

/**
 * One row of `chat_pointers`, minus the ids the caller already knows.
 *
 * `startChar`/`endChar` are CODE POINTS, because Postgres substring() counts
 * characters and JS indices count UTF-16 units — an emoji is one of the first
 * and two of the second. Retrieval reads the text back with substring().
 */
export type PointerRow = {
  ordinal: number
  kind: ProseSpan['kind']
  startChar: number
  endChar: number
  matchText: string
}

export type SkippedSpan = { kind: ProseSpan['kind']; length: number }

/**
 * Ticket 15: a sentence longer than `limit` is cut into consecutive chunks of
 * at most `limit` UTF-16 units. Each chunk ends just after a whitespace
 * character when one is in reach, else it is cut hard — never inside a
 * surrogate pair. The chunks together are exactly the sentence: nothing is lost.
 *
 * Why at all: pg_trgm's strict_word_similarity is QUADRATIC in a passage's
 * length (18 ms at 5k chars, 2.5 s at 80k), and one unpunctuated 824k-char
 * message became one passage that froze retrieval for 28 minutes on the
 * single PGlite connection. A sentence over the 8,000-char memory budget could
 * never be sent anyway. Revisits ticket 05's Q11/Q13.
 */
export function chunkSpan(content: string, start: number, end: number, limit: number): [number, number][] {
  const out: [number, number][] = []
  let pos = start
  while (end - pos > limit) {
    let cut = -1
    for (let i = pos + limit - 1; i > pos; i--) {
      if (/\s/.test(content[i])) {
        cut = i + 1
        break
      }
    }
    if (cut < 0) {
      cut = pos + limit
      const unit = content.charCodeAt(cut - 1)
      if (unit >= 0xd800 && unit <= 0xdbff) cut -= 1 // do not split an emoji
    }
    out.push([pos, cut])
    pos = cut
  }
  out.push([pos, end])
  return out
}

/**
 * The pointers for one message, and what was too big to index.
 *
 * The limit skips code blocks and tables over it (ticket 05, Q11/Q13), and
 * splits a sentence over it into chunks (ticket 15). Ordinals count KEPT rows,
 * so a ±1 neighbour is always a real row.
 */
export function pointerRows(
  content: string,
  limit: number = PROVISIONAL.spanCharLimit,
): { rows: PointerRow[]; skipped: SkippedSpan[] } {
  const rows: PointerRow[] = []
  const skipped: SkippedSpan[] = []
  // Spans arrive in increasing order, so code points are counted in ONE
  // forward pass: cu = UTF-16 index reached, cp = code points before it.
  // Re-counting from 0 for every span was O(length x spans): 6.7 s for a
  // 4,000-sentence paste, which froze the one-connection server on save.
  let cu = 0
  let cp = 0
  const toCodePoints = (target: number) => {
    while (cu < target) {
      const code = content.charCodeAt(cu)
      // Count a UTF-16 pair (surrogate pair) only if both units are present
      // and form a valid pair: high surrogate (0xD800-0xDBFF) + low surrogate (0xDC00-0xDFFF).
      // Unpaired surrogates count as 1 code point, matching Array.from() behavior.
      cu += code >= 0xd800 && code <= 0xdbff && cu + 1 < content.length && (content.charCodeAt(cu + 1) & 0xfc00) === 0xdc00 ? 2 : 1
      cp += 1
    }
    return cp
  }

  for (const span of proseSpans(content)) {
    const length = span.end - span.start
    if (span.kind !== 'sentence' && length > limit) {
      skipped.push({ kind: span.kind, length })
      continue
    }
    const pieces: [number, number][] =
      span.kind === 'sentence' && length > limit ? chunkSpan(content, span.start, span.end, limit) : [[span.start, span.end]]
    for (const [start, end] of pieces) {
      rows.push({
        ordinal: rows.length,
        kind: span.kind,
        startChar: toCodePoints(start),
        endChar: toCodePoints(end),
        matchText: content.slice(start, end),
      })
    }
  }
  return { rows, skipped }
}

/** One log line for one skip. Shared by the chat route and the backfill so they read alike. */
export function describeSkip(chatId: string, messageId: string, s: SkippedSpan): string {
  return `message ${messageId} in chat ${chatId}: skipped ${s.kind} (${s.length} chars > ${PROVISIONAL.spanCharLimit} limit)`
}
