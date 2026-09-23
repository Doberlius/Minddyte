/**
 * Markdown syntax removed from a sentence for DISPLAY only.
 *
 * A passage keeps what was said byte for byte, which is the guarantee the
 * Archive is built on. A model writes a lot of that in markdown, so the panel
 * showing "your own sentences" was showing `**parallelize** the writing` and
 * `### Why Postgres wins` — the right bytes, reading like a rendering fault.
 *
 * This drops the syntax and keeps every word. It is not a rewrite: the stored
 * sentence never changes, and the text this returns, concatenated, is the same
 * text minus the markers. The tests assert exactly that on every case.
 *
 * Inline only, and deliberately so. Memory holds SENTENCES, cut out of
 * longer messages, so a full markdown parser would be given input it can only
 * misread — a sentence that begins inside a list, or ends mid-emphasis. An
 * unmatched marker is therefore left exactly where it is rather than
 * swallowing the rest of the line.
 */

export type InlinePart = {
  text: string
  bold?: true
  italic?: true
  code?: true
}

/** A leading marker belongs to the document's structure, not to the sentence. */
const LEADING = /^\s*(?:#{1,6}\s+|[*-]\s+|\d+\.\s+|>\s+)/

/**
 * Block markers that landed in the MIDDLE of a sentence.
 *
 * `splitSentences` cuts on terminators, so a heading or a rule further down a
 * reply arrives glued to the end of the sentence before it — the real archive
 * showed "...with the Mindset and Grill with Docs: ### 1." and "in this
 * business --- ### 1.".
 *
 * Safe to remove anywhere because neither carries a word: `#` is only a marker
 * when whitespace follows it, which leaves `#42` alone, and a rule is three or
 * more of the same character standing by itself, which leaves an em dash and
 * `well-known` alone.
 */
const BLOCK_ANYWHERE = /(?:^|\s)(?:#{1,6}(?=\s)|-{3,}|\*{3,}|_{3,})(?=\s|$)/g

/**
 * Ordered: the longer marker is tried first, so `**a**` is bold rather than
 * italic wrapping an asterisk. Each pattern requires a non-space just inside
 * the markers, which is what keeps `2 * 3 * 4` and a lone `**` out.
 */
const SPANS: { re: RegExp; mark: Exclude<keyof InlinePart, 'text'> }[] = [
  { re: /\*\*(?=\S)([\s\S]*?\S)\*\*/, mark: 'bold' },
  { re: /`(?=\S)([^`]*?\S)`/, mark: 'code' },
  { re: /(?<![*\w])\*(?=\S)([^*]*?\S)\*(?!\*)/, mark: 'italic' },
]

export function splitInline(input: string): InlinePart[] {
  const source = input
    .replace(LEADING, '')
    .replace(BLOCK_ANYWHERE, ' ')
    // Removing a marker leaves the space that was on each side of it.
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
  if (!source) return []

  const parts: InlinePart[] = []
  let rest = source

  while (rest) {
    // Whichever span starts earliest wins, so the markers are handled in the
    // order they appear rather than in the order they are listed here.
    let best: { index: number; length: number; inner: string; mark: keyof InlinePart } | null = null
    for (const { re, mark } of SPANS) {
      const m = rest.match(re)
      if (!m || m.index === undefined) continue
      if (best === null || m.index < best.index) {
        best = { index: m.index, length: m[0].length, inner: m[1], mark }
      }
    }

    if (!best) {
      parts.push({ text: rest })
      break
    }

    if (best.index > 0) parts.push({ text: rest.slice(0, best.index) })
    parts.push({ text: best.inner, [best.mark]: true } as InlinePart)
    rest = rest.slice(best.index + best.length)
  }

  // Empty runs come from markers that sat against each other; they would
  // render as nothing anyway and only make the output harder to read.
  return parts.filter((p) => p.text !== '')
}
