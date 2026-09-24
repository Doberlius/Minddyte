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
 * The pointers for one message, and what was too big to index.
 *
 * The limit applies to code blocks and tables only (ticket 05, Q11/Q13). A
 * long sentence is still a sentence, and the read-time budget decides whether
 * it fits. Ordinals count KEPT spans, so a ±1 neighbour is always a real row.
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
    rows.push({
      ordinal: rows.length,
      kind: span.kind,
      startChar: toCodePoints(span.start),
      endChar: toCodePoints(span.end),
      matchText: content.slice(span.start, span.end),
    })
  }
  return { rows, skipped }
}

/** One log line for one skip. Shared by the chat route and the backfill so they read alike. */
export function describeSkip(chatId: string, messageId: string, s: SkippedSpan): string {
  return `message ${messageId} in chat ${chatId}: skipped ${s.kind} (${s.length} chars > ${PROVISIONAL.spanCharLimit} limit)`
}
