import { cpLength } from '@/lib/quote'

/**
 * Where a selected text sits in a message's stored content, as code-point
 * offsets, or null when it cannot be placed exactly.
 *  - Your own message is shown verbatim, so `selected` is found as-is; `hint`
 *    (the UTF-16 index of the selection's start inside the bubble's text)
 *    picks the occurrence when it repeats.
 *  - A model reply is rendered markdown, so the shown text drops syntax
 *    (`**`, `` ` ``, `[`, `](url)`, `#`, `>`, list markers). Match on a
 *    normalised form (those markers removed, whitespace runs collapsed) with
 *    an index map back to the original; a match must be unique, or null.
 *
 * Null is never wrong: the caller then quotes the whole message. A wrong part
 * is, so every doubt ends in null.
 */
export function selectionOffsets(
  content: string,
  selected: string,
  opts: { verbatim: boolean; hint?: number },
): { start: number; end: number } | null {
  if (!selected.trim()) return null
  return opts.verbatim ? verbatimOffsets(content, selected, opts.hint) : replyOffsets(content, selected)
}

/** Your own message: an exact match, the nearest to `hint` when it repeats, and no guess on a tie. */
function verbatimOffsets(content: string, selected: string, hint: number | undefined) {
  const hits: number[] = []
  for (let i = content.indexOf(selected); i !== -1; i = content.indexOf(selected, i + 1)) {
    // A match that starts on the second half of an emoji is not a real selection.
    const unit = content.charCodeAt(i)
    if (unit < 0xdc00 || unit > 0xdfff) hits.push(i)
  }
  let at: number
  if (hits.length === 1) at = hits[0]
  else {
    if (hits.length === 0 || hint === undefined) return null
    const far = hits.map((i) => Math.abs(i - hint))
    const near = Math.min(...far)
    if (far.filter((d) => d === near).length > 1) return null
    at = hits[far.indexOf(near)]
  }
  const start = cpLength(content.slice(0, at))
  return { start, end: start + cpLength(selected) }
}

/* ------------------------------------------------------------------------ *
 * A model reply.
 *
 * The stored markdown becomes a list of tokens (one per code point, or one
 * per wild stretch) saying what it can look like on screen:
 *   lit   — always shown as itself;
 *   opt   — may be hidden syntax or shown as itself (`*`, `#`, `|`, a link's
 *           URL, a list marker, whitespace…);
 *   wild  — a stretch the renderer turns into OTHER text (maths, an image's
 *           "image: …" label, a code block's language and Copy button, an
 *           HTML entity). It may show any text made of the characters it
 *           allows, or nothing.
 * The model errs one way only: anything that might be hidden is `opt`, and
 * anything that might show other text is `wild`. So every way the reply can
 * really look is one path through the tokens, and the selection's true place
 * is always among the paths the matcher finds.
 *
 * The selection (whitespace runs as one space) is matched along every path.
 * Its place is returned only when all the paths agree on one span and none of
 * them reads a character out of a `wild` stretch (reading only whitespace out
 * of one is fine: the span is the same either way); otherwise null. `hint` is
 * not used here: the bubble's text is not the stored text, so its index
 * cannot be trusted to break a tie.
 *
 * Whitespace: a space in the selection stands for "something was skipped
 * here" (whitespace, a table pipe, a tag); whitespace in the reply may also
 * be skipped, since a cell or a code span can drop it.
 * ------------------------------------------------------------------------ */

type Allows = (c: string) => boolean
type Token = { kind: 'lit' | 'opt'; ch: string; at: number } | { kind: 'wild'; at: number; allows: Allows; max: number }
type Wild = { from: number; to: number; allows: Allows; max: number }

/** A footnote is numbered and moved to the end; a diagram card shows text that is not stored. */
const UNPLACEABLE = [/\[\^[^\]\s]+\]/, /^[ \t>]*(?:`{3,}|~{3,})[ \t]*scene\b/m]

const SYNTAX = new Set(['*', '_', '~', '`', '#', '>', '<', '|', '[', ']', '\\'])
const WHITESPACE = /\s/u

/** Line starts: blockquote `>`, list markers, task boxes. */
const LINE_PREFIX = /^(?:[ \t]*(?:>|[-*+](?=[ \t]|$)|\d{1,9}[.)](?=[ \t]|$)|\[[ xX]\](?=[ \t]|$)))+/gm
/** Lines of syntax only: thematic breaks, setext underlines, a table's delimiter row. */
const SYNTAX_LINE = /^(?=[^\n]*[-=_*])[ \t|:+\-=_*]+$/gm
/** `[label]: https://…` — a link reference definition renders nothing. */
const LINK_DEFINITION = /^ {0,3}\[[^\]\n]+\]:[ \t]*\S[^\n]*$/gm
/** `][label]` of a reference link. */
const LINK_REFERENCE = /\]\[[^\]\n]*\]/g
const HTML_COMMENT = /<!--[\s\S]*?(?:-->|$)/g
const HTML_TAG = /<(\/?)([A-Za-z][A-Za-z0-9-]*)(?:\s[^<>]*)?(\/?)>/g
const VOID_TAGS = new Set(['br', 'hr', 'img', 'input', 'wbr', 'area', 'base', 'col', 'embed', 'link', 'meta', 'source', 'track'])
const ENTITY = /&(?:#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[A-Za-z][A-Za-z0-9]{1,31});/g
const IMAGE = /!\[(?:[^[\]\n]|\[[^[\]\n]*\])*\]/g
/** Any line that may open or close a fenced block, wherever a list or quote put it. */
const FENCE_LINE = /^[ \t>]*(?:(?:[-*+]|\d{1,9}[.)])[ \t]+)*(?:`{3,}|~{3,})[^\n]*$/gm
/** The indent of any line that may be indented code, inside quotes too. */
const INDENTED = /^(?:[ \t]*>)*(?: {4}|\t)/gm

/** Maths in every form normalizeMath (src/lib/math.ts) turns into $$…$$; its single-dollar rule is copied. */
const MATH = [
  /\$\$[\s\S]+?\$\$/g,
  /\\\(([\s\S]+?)\\\)/g,
  /\\\[([\s\S]+?)\\\]/g,
  /(?<![\\$\w])\$(?![\s$])((?:\\.|[^$\\\n])*?)(?<![\s\\])\$(?![\d$])/g,
]

/** Text the renderer adds: the code block header and the image label. */
const HEADER_TEXT = 'text Copy Copied Couldn’t copy'
const IMAGE_TEXT = 'image: untitled'

const charsOf = (...texts: string[]): Allows => {
  const set = new Set<string>()
  for (const t of texts) for (const c of t) set.add(c)
  return (c) => c === ' ' || set.has(c)
}

/**
 * What KaTeX can show for a formula: its own source (the MathML annotation
 * carries it), plus symbols that are not plain letters or digits, Greek,
 * accented Latin and letter-like symbols (ℝ, ℓ, ℏ…).
 */
const mathChars = (source: string): Allows => {
  const own = charsOf(source)
  return (c) => own(c) || !/[\p{L}\p{N}]/u.test(c) || /[\p{Script=Greek}À-ɏ℀-⅏]/u.test(c)
}

/**
 * An entity shows as itself (in code) or as what it stands for: a numeric
 * one as its character, a named one as some character that is never a plain
 * ASCII letter or digit (&amp; &lt; &nbsp; &copy; &eacute;…).
 */
const entityChars = (entity: string): Allows => {
  const own = charsOf(entity)
  const numeric = /^&#(x?)([0-9a-f]+);$/i.exec(entity)
  if (numeric) {
    const code = parseInt(numeric[2], numeric[1] ? 16 : 10)
    const shown = code <= 0x10ffff ? String.fromCodePoint(code) : '�'
    return (c) => own(c) || c === shown || c === '�'
  }
  return (c) => own(c) || !/[A-Za-z0-9]/.test(c)
}

function replyOffsets(content: string, selected: string) {
  if (UNPLACEABLE.some((re) => re.test(content))) return null
  const want = Array.from(selected.replace(/\s+/g, ' ').trim())
  return match(tokenize(content), want)
}

function tokenize(content: string): Token[] {
  const cps = Array.from(content)
  // UTF-16 index → code-point index, for regex matches.
  const cp = new Int32Array(content.length + 1)
  for (let u = 0, c = 0; u <= content.length; c++) {
    cp[u] = c
    const wide = u < content.length && content.codePointAt(u)! > 0xffff
    if (wide) cp[u + 1] = c
    u += wide ? 2 : 1
  }
  const optional = new Uint8Array(cps.length)
  const wilds: Wild[] = []
  const hide = (from: number, to: number) => optional.fill(1, cp[from], cp[to])
  const wild = (from: number, to: number, allows: Allows, max = Infinity) =>
    wilds.push({ from: cp[from], to: cp[to], allows, max })
  const each = (re: RegExp, fn: (m: RegExpMatchArray, from: number, to: number) => void) => {
    for (const m of content.matchAll(re)) fn(m, m.index!, m.index! + m[0].length)
  }

  cps.forEach((c, i) => {
    if (SYNTAX.has(c) || WHITESPACE.test(c)) optional[i] = 1
  })
  each(LINE_PREFIX, (_, a, b) => hide(a, b))
  each(SYNTAX_LINE, (_, a, b) => hide(a, b))
  each(LINK_DEFINITION, (_, a, b) => hide(a, b))
  each(LINK_REFERENCE, (_, a, b) => hide(a, b))
  for (let i = content.indexOf(']('); i !== -1; i = content.indexOf('](', i + 1)) hide(i, destinationEnd(content, i + 2))
  // HTML in a code block is shown as text, so it hides nothing there.
  const code = fencedCode(content)
  const inCode = (at: number) => code.some(([from, to]) => at >= from && at < to)
  each(HTML_COMMENT, (_, a, b) => {
    if (!inCode(a)) hide(a, b)
  })
  each(HTML_TAG, (m, a, b) => {
    if (inCode(a)) return
    const name = m[2].toLowerCase()
    if (name === 'img') return wild(a, b, charsOf(IMAGE_TEXT, m[0]))
    // An element's content may be hidden too (<details>, <script>…).
    let end = b
    if (!m[1] && !m[3] && !VOID_TAGS.has(name)) {
      const closing = new RegExp(`</${name}\\b`, 'gi')
      closing.lastIndex = b
      end = closing.exec(content)?.index ?? b
    }
    hide(a, end)
  })
  each(IMAGE, (_, a, b) => {
    const end = content[b] === '(' ? destinationEnd(content, b + 1) : b
    wild(a, end, charsOf(IMAGE_TEXT, content.slice(a, end)))
  })
  each(ENTITY, (m, a, b) => wild(a, b, entityChars(m[0]), m[0].length))
  for (const re of MATH) each(re, (m, a, b) => wild(a, b, mathChars(m[0])))
  const dollars = [...content.matchAll(/\$\$/g)]
  if (dollars.length % 2 === 1) {
    const a = dollars[dollars.length - 1].index!
    wild(a, content.length, mathChars(content.slice(a)))
  }
  // A code block shows a header (its language or "text", and a Copy button)
  // that is not stored. It sits at an opening fence or before an indented
  // block. Telling an opening fence from a closing one, or an indented block
  // from a nested list, is left undone on purpose: every candidate gets the
  // header, which costs nothing unless the selection could be header text.
  each(FENCE_LINE, (m, a, b) => wild(a, b, charsOf(HEADER_TEXT, m[0])))
  each(INDENTED, (m, a, b) => wild(a, b, charsOf(HEADER_TEXT, m[0])))

  return tokensOf(cps, optional, wilds)
}

/**
 * Fenced code blocks whose fence starts a line, unindented and outside any
 * quote or list, as UTF-16 ranges from the opening fence to the end of the
 * closing one (or of the reply, when it never closes). Only these: a block
 * missed here is merely treated as prose, which can hide more, never less.
 */
function fencedCode(content: string): [number, number][] {
  const out: [number, number][] = []
  const line = /^.*$/gm
  let open: { at: number; ch: string; len: number } | null = null
  for (let m = line.exec(content); m; m = line.exec(content)) {
    const fence = /^(`{3,}|~{3,})/.exec(m[0])
    if (!open) {
      if (fence) open = { at: m.index, ch: fence[1][0], len: fence[1].length }
    } else if (fence && fence[1][0] === open.ch && fence[1].length >= open.len && /^[`~]+[ \t]*$/.test(m[0])) {
      out.push([open.at, m.index + m[0].length])
      open = null
    }
    if (m[0] === '') line.lastIndex++
  }
  if (open) out.push([open.at, content.length])
  return out
}

/** Where a link destination `(url "title")` ends: its balancing `)`, or the end of the line. */
function destinationEnd(content: string, from: number): number {
  let depth = 1
  let quoted = false
  for (let i = from; i < content.length; i++) {
    const c = content[i]
    if (c === '\n' && content[i + 1] === '\n') return i
    if (c === '\\') i++
    else if (c === '"') quoted = !quoted
    else if (!quoted && c === '(') depth++
    else if (!quoted && c === ')' && --depth === 0) return i + 1
  }
  const eol = content.indexOf('\n', from)
  return eol === -1 ? content.length : eol
}


function tokensOf(cps: string[], optional: Uint8Array, wilds: Wild[]): Token[] {
  // Overlapping wild stretches merge into one, allowing what either allows.
  const merged: Wild[] = []
  for (const w of wilds.filter((w) => w.to > w.from).sort((a, b) => a.from - b.from)) {
    const last = merged[merged.length - 1]
    if (last && w.from < last.to) {
      const [a, b] = [last.allows, w.allows]
      last.allows = (c) => a(c) || b(c)
      last.to = Math.max(last.to, w.to)
      last.max = last.max + w.max
    } else merged.push({ ...w })
  }
  const tokens: Token[] = []
  let next = 0
  for (let i = 0; i < cps.length; ) {
    const w = merged[next]
    if (w && w.from === i) {
      tokens.push({ kind: 'wild', at: i, allows: w.allows, max: w.max })
      i = Math.max(w.to, i + 1)
      next++
      continue
    }
    const space = WHITESPACE.test(cps[i])
    tokens.push({ kind: optional[i] ? 'opt' : 'lit', ch: space ? ' ' : cps[i], at: i })
    i++
  }
  return tokens
}

/* ------------------------------------------------------------------------ *
 * The matcher: every path at once, one selected character at a time.
 * ------------------------------------------------------------------------ */

type State = {
  /** The next token to read. */
  p: number
  /** Characters the wild token at `p` has read so far (0: not reading it). */
  w: number
  /** Something was skipped since the last character read (a space may stand for it). */
  skipped: boolean
  /** Code points of the first and last character read. */
  start: number
  last: number
  /** Read a character out of a wild stretch: the place is unknown. */
  tainted: boolean
}

/**
 * Past this, the reply is too repetitive to be sure of anything cheaply. Both
 * are checked as the work happens, not after a step: one step over a long
 * stretch that may be hidden can otherwise grow without bound (final review
 * finding 1).
 */
const MAX_STATES = 5_000
const MAX_WORK = 1_000_000

function match(tokens: Token[], want: string[]) {
  let work = 0
  let over = false
  let states = new Map<string, State>()
  const add = (into: Map<string, State>, s: State) => {
    const key = s.tainted ? `t${s.p},${s.w},${s.skipped}` : `${s.p},${s.w},${s.skipped},${s.start},${s.last}`
    if (!into.has(key)) into.set(key, s)
    if (into.size > MAX_STATES) over = true
  }
  const read = (s: State, c: string, into: Map<string, State>) => {
    const t = tokens[s.p]
    if (!t) return
    if (t.kind === 'wild') {
      // Reading only whitespace out of a wild stretch places nothing in it.
      if (s.w < t.max && t.allows(c)) {
        add(into, { ...s, w: t.max === Infinity ? 1 : s.w + 1, skipped: false, tainted: s.tainted || c !== ' ' })
      }
    } else if (t.ch === c && c !== ' ') {
      add(into, { ...s, p: s.p + 1, w: 0, skipped: false, start: s.start === -1 ? t.at : s.start, last: t.at })
    }
  }

  const first = want[0]
  for (let p = 0; p < tokens.length && !over; p++) read({ p, w: 0, skipped: false, start: -1, last: -1, tainted: false }, first, states)
  if (over) return null

  for (let k = 1; k < want.length; k++) {
    const c = want[k]
    const next = new Map<string, State>()
    for (const s of states.values()) {
      // Every way on from `s`: stay, leave the wild stretch being read, skip what may be hidden.
      let p = s.p
      const around: State[] = [s]
      if (s.w > 0) around.push({ ...s, p: ++p, w: 0, skipped: true })
      while (p < tokens.length && tokens[p].kind !== 'lit') {
        around.push({ ...s, p: ++p, w: 0, skipped: true })
        if (++work > MAX_WORK) return null
      }
      for (const a of around) {
        read(a, c, next)
        if (c === ' ' && a.skipped) add(next, { ...a, skipped: false })
        if (over) return null
      }
    }
    if (next.size === 0) return null
    states = next
  }

  let found: State | null = null
  for (const s of states.values()) {
    if (s.tainted) return null
    if (found && (found.start !== s.start || found.last !== s.last)) return null
    found = s
  }
  return found && { start: found.start, end: found.last + 1 }
}
