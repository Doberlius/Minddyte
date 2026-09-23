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
  const toCodePoints = (i: number) => Array.from(content.slice(0, i)).length

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
