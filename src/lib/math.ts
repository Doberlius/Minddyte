/**
 * LaTeX delimiters in model text, made unambiguous for remark-math.
 *
 * Models write maths four ways: $…$, $$…$$, \(…\) and \[…\]. remark-math
 * reads only dollars — and markdown eats the backslash in \( and \[, so
 * those arrive as plain brackets. A bare $ is also money: "costs $5 and $10"
 * must stay text. So remark-math runs with single-dollar maths OFF, and this
 * rewrites every form to $$…$$ first:
 *
 *   $…$    -> $$…$$   only by Pandoc's rule: no space just inside either $,
 *                     and the closing $ not followed by a digit. "$5 and $10"
 *                     and "$5-$10" fail it; "$x$" and "$\bullet$" pass.
 *   \(…\)  -> $$…$$   inline
 *   \[…\]  -> $$…$$   on lines of its own, so it becomes a display block
 *   $$…$$  -> left as it is
 *
 * Code is never touched: fenced blocks and `inline code` pass through
 * byte for byte, so $HOME, $x in bash, or PHP keep their dollars.
 */

/** Pandoc's single-dollar rule. Escaped \$ and a $ glued to a word never open. */
const SINGLE = /(?<![\\$\w])\$(?![\s$])((?:\\.|[^$\\\n])*?)(?<![\s\\])\$(?![\d$])/g
const PAREN = /\\\(([\s\S]+?)\\\)/g
const BRACKET = /\\\[([\s\S]+?)\\\]/g
const INLINE_CODE = /(`+)[\s\S]*?\1/g
const FENCE = /^ {0,3}(`{3,}|~{3,})/

function rewrite(prose: string): string {
  return prose
    .replace(BRACKET, (_, tex: string) => `\n$$\n${tex.trim()}\n$$\n`)
    .replace(PAREN, (_, tex: string) => `$$${tex}$$`)
    .replace(SINGLE, (_, tex: string) => `$$${tex}$$`)
}

/** Rewrites prose, leaving `inline code` spans exactly as they are. */
function outsideInlineCode(text: string, fn: (prose: string) => string): string {
  let out = ''
  let last = 0
  for (const m of text.matchAll(INLINE_CODE)) {
    out += fn(text.slice(last, m.index)) + m[0]
    last = m.index + m[0].length
  }
  return out + fn(text.slice(last))
}

export function normalizeMath(markdown: string): string {
  const lines = markdown.split('\n')
  const out: string[] = []
  let prose: string[] = []
  let fence: string | null = null
  const flush = () => {
    if (prose.length) out.push(outsideInlineCode(prose.join('\n'), rewrite))
    prose = []
  }
  for (const line of lines) {
    const marker = line.match(FENCE)?.[1]
    if (fence === null && marker) {
      flush()
      fence = marker
      out.push(line)
    } else if (fence !== null) {
      out.push(line)
      // A fence closes on the same character, at least as long.
      if (marker && marker[0] === fence[0] && marker.length >= fence.length) fence = null
    } else {
      prose.push(line)
    }
  }
  flush()
  return out.join('\n')
}

export type MathPart = { text: string; math?: true }

/** Every inline form, for a stored sentence (which has no display blocks). */
const ANY = new RegExp(
  [/\$\$([\s\S]+?)\$\$/.source, PAREN.source, BRACKET.source, SINGLE.source].join('|'),
  'g',
)

/**
 * A stored sentence, split into text and maths. Money and `inline code`
 * stay text. Adjacent text is merged, so a sentence with no maths is one part.
 */
export function splitMath(text: string): MathPart[] {
  const parts: MathPart[] = []
  const pushText = (t: string) => {
    if (!t) return
    const prev = parts[parts.length - 1]
    if (prev && !prev.math) prev.text += t
    else parts.push({ text: t })
  }
  const scan = (prose: string) => {
    let last = 0
    for (const m of prose.matchAll(ANY)) {
      pushText(prose.slice(last, m.index))
      parts.push({ text: (m[1] ?? m[2] ?? m[3] ?? m[4]).trim(), math: true })
      last = m.index + m[0].length
    }
    pushText(prose.slice(last))
  }
  let last = 0
  for (const m of text.matchAll(INLINE_CODE)) {
    scan(text.slice(last, m.index))
    pushText(m[0])
    last = m.index + m[0].length
  }
  scan(text.slice(last))
  return parts
}
