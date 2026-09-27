import { Fragment, type ReactNode } from 'react'
import katex from 'katex'
import 'katex/dist/katex.min.css'
import { splitInline } from '@/lib/inline-markdown'
import { splitMath } from '@/lib/math'

/**
 * A stored sentence, shown with its inline markdown rendered: **bold**,
 * *italic*, `code` and inline LaTeX ($…$, \(…\), $$…$$) become real
 * formatting, and a leading `###` or bullet marker is dropped. The stored
 * text never changes — only its display.
 *
 * Inline only, on purpose: a sentence is cut out of a longer reply, so it can
 * start inside a list or end mid-emphasis. A full markdown parser would
 * misread that; `splitInline` leaves an unmatched marker where it is.
 *
 * Maths is swapped for placeholders BEFORE splitInline runs, so a `*` or `_`
 * inside a formula is never read as emphasis, then swapped back in.
 */
const SLOT = /(\d+)/g

function withMath(text: string, maths: string[], key: string): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  for (const m of text.matchAll(SLOT)) {
    if (m.index > last) out.push(text.slice(last, m.index))
    // KaTeX escapes its input and renders only maths (trust is off), so its
    // HTML is safe to insert; a formula it cannot parse shows as red source.
    const html = katex.renderToString(maths[Number(m[1])], { throwOnError: false, errorColor: '#B91C1C' })
    out.push(<span key={`${key}-${m.index}`} dangerouslySetInnerHTML={{ __html: html }} />)
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

export function InlineText({ text }: { text: string }) {
  const maths: string[] = []
  const slotted = splitMath(text)
    .map((p) => (p.math ? `${maths.push(p.text) - 1}` : p.text))
    .join('')
  return (
    <>
      {splitInline(slotted).map((part, i) => {
        const inner = withMath(part.text, maths, String(i))
        return part.bold ? (
          <strong key={i}>{inner}</strong>
        ) : part.italic ? (
          <em key={i}>{inner}</em>
        ) : part.code ? (
          // splitMath leaves `code` alone, so code never holds a maths slot.
          <code key={i}>{part.text}</code>
        ) : (
          <Fragment key={i}>{inner}</Fragment>
        )
      })}
    </>
  )
}
