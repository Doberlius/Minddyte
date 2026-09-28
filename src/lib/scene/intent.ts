/**
 * Does this message ask for a diagram? A word check, not a model call
 * (spec §3). "graph" and "plot" are deliberately absent: this app talks about
 * knowledge graphs, and "the plot of Hamlet" is not a request to draw.
 */
const COMMAND = /^\s*\/visualize\b/i
const STRIP = /^\s*\/visualize\b\s*/i
const ASKS_TO_SEE = /\b(show me|visuali[sz]e|animate|illustrate|draw (me |a |an )?|diagrams?)\b/i

export function wantsDiagram(message: string): boolean {
  return COMMAND.test(message) || ASKS_TO_SEE.test(message)
}

/** The text memory reads: the leading /visualize word is a command, not a concept. */
export function stripVisualize(message: string): string {
  return COMMAND.test(message) ? message.replace(STRIP, '') : message
}

/**
 * The code-point length of the exact prefix `stripVisualize` removes — 0 for
 * anything that is not a `/visualize` command.
 *
 * Pointers are offsets read back from the STORED message (retrieval.ts,
 * forget.ts), which still has the command in front, while extraction/title
 * reads `stripVisualize`'s shorter text — so a pointer built from the
 * stripped text lands `visualizePrefixLength(draft)` characters too early
 * unless that many code points are added back to every offset
 * (`pointerRows`'s `shift` parameter does exactly this).
 *
 * Safe to treat as a UTF-16 length too, not just a code-point count: the
 * removed prefix is leading whitespace plus the literal word "/visualize"
 * plus trailing whitespace, and every character `\s` can match there is a
 * single UTF-16 code unit — this prefix can never contain a surrogate pair.
 *
 * (An earlier version of this fix instead built pointers from the STORED
 * text with the command blanked out to a same-length filler. That worked
 * for offsets, but made `match_text` — the pg_trgm search index — contain
 * filler characters instead of clean words, and briefly (with a naive space
 * filler) made remark misread the blanked run as CommonMark's indented-code
 * syntax. Shifting offsets after building pointers from the already-clean
 * `memoryDraft` avoids both: `match_text` is exactly what extraction sees,
 * and nothing about the message's Markdown shape is disturbed.)
 */
export function visualizePrefixLength(message: string): number {
  const m = STRIP.exec(message)
  return m ? m[0].length : 0
}
