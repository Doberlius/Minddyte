import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import { splitSentences } from './text'

/**
 * Where the memory-worthy parts of a message are. Offsets are UTF-16 indices
 * into `text` (what remark reports and what `text.slice` takes).
 *
 * The sentences of a message, with markdown parsed away first. Ticket 11.
 *
 * Replies arrive as markdown, and splitSentences alone stored heading hashes,
 * table pipes and bullet markers into Compactions as if they were memory.
 * The principle: markup is not content; words are. Removing `## ` changes no
 * proposition, so the verbatim rule — which exists to protect meaning — is
 * not broken by it.
 *
 * A parser, never a model: markdown is a formal grammar with nothing to
 * infer, and remark is deterministic (same text in, same tree out), which
 * keeps Decision 3 intact. It is already installed via react-markdown.
 *
 * Paragraphs are split into sentences. Code blocks and tables are now returned
 * as whole spans rather than dropped, so the retrieval layer can decide whether
 * they fit.
 *
 * Only PARAGRAPH nodes are read, wherever they sit — top level, inside a list
 * item, inside a blockquote. Everything else is skipped by construction:
 *   - code blocks: returned as ONE span, fences included, so the model sees it is code;
 *   - tables: returned as ONE span; a single row out of context can mislead;
 *   - headings: a label, not a claim ("## 1." measured as a whole "sentence").
 *
 * Each paragraph is split on its own. Joining them first reproduces the
 * gluing bug in miniature: "Overview" has no full stop, so it fused with the
 * next paragraph's first sentence.
 *
 * The paragraph's SOURCE text is kept, inline markup included (`**17 Goals**`,
 * `max.poll.records` in backticks). Stripping inline syntax would also strip
 * link URLs, which can be the fact itself.
 */
export type ProseSpan = { kind: 'sentence' | 'code' | 'table'; start: number; end: number }

type MdNode = {
  type: string
  children?: MdNode[]
  position?: { start: { offset?: number }; end: { offset?: number } }
}

const parser = unified().use(remarkParse).use(remarkGfm)

/**
 * Where the memory-worthy parts of a message are. Offsets are UTF-16 indices
 * into `text` (what remark reports and what `text.slice` takes).
 *
 *   paragraph -> one span per sentence, split on its own (never on joined text)
 *   code      -> ONE span, fences included, so the model sees it is code
 *   table     -> ONE span; a single row out of context can mislead
 *   heading   -> nothing; a label, not a claim
 */
export function proseSpans(text: string): ProseSpan[] {
  if (!text.trim()) return []
  const tree = parser.parse(text) as MdNode
  const out: ProseSpan[] = []
  const walk = (node: MdNode) => {
    const start = node.position?.start.offset
    const end = node.position?.end.offset
    if (node.type === 'code' || node.type === 'table') {
      if (start !== undefined && end !== undefined) out.push({ kind: node.type, start, end })
      return
    }
    if (node.type === 'paragraph') {
      if (start === undefined || end === undefined) return
      const para = text.slice(start, end)
      let cursor = 0
      for (const sentence of splitSentences(para)) {
        // splitSentences returns verbatim substrings, in order, so each one is
        // found at or after the end of the previous one.
        const at = para.indexOf(sentence, cursor)
        out.push({ kind: 'sentence', start: start + at, end: start + at + sentence.length })
        cursor = at + sentence.length
      }
      return
    }
    for (const child of node.children ?? []) walk(child)
  }
  walk(tree)
  return out
}

/** The sentences only, as text. Used by the Compaction until it is dropped. */
export function proseSentences(text: string): string[] {
  return proseSpans(text)
    .filter((s) => s.kind === 'sentence')
    .map((s) => text.slice(s.start, s.end))
}
