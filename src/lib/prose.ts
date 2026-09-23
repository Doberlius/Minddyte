import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import { splitSentences } from './text'

/**
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
 * Only PARAGRAPH nodes are read, wherever they sit — top level, inside a list
 * item, inside a blockquote. Everything else is skipped by construction:
 *   - code blocks: a pasted snippet is not a sentence (compaction.ts's
 *     existing carve-out for "a pasted code block");
 *   - tables: cells are fragments, not propositions;
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
type MdNode = {
  type: string
  children?: MdNode[]
  position?: { start: { offset?: number }; end: { offset?: number } }
}

const parser = unified().use(remarkParse).use(remarkGfm)

export function proseSentences(text: string): string[] {
  if (!text.trim()) return []
  const tree = parser.parse(text) as MdNode
  const out: string[] = []
  const walk = (node: MdNode) => {
    if (node.type === 'paragraph') {
      const start = node.position?.start.offset
      const end = node.position?.end.offset
      if (start !== undefined && end !== undefined) out.push(...splitSentences(text.slice(start, end)))
      return
    }
    // A table cell holds phrasing, never a paragraph, so tables fall out here
    // without a special case. Code has no children at all.
    for (const child of node.children ?? []) walk(child)
  }
  walk(tree)
  return out
}
