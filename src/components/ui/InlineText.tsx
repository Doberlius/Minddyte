import { Fragment } from 'react'
import { splitInline } from '@/lib/inline-markdown'

/**
 * A stored sentence, shown with its inline markdown rendered: **bold**,
 * *italic* and `code` become real formatting, and a leading `###` or bullet
 * marker is dropped. The stored text never changes — only its display.
 *
 * Inline only, on purpose: a sentence is cut out of a longer reply, so it can
 * start inside a list or end mid-emphasis. A full markdown parser would
 * misread that; `splitInline` leaves an unmatched marker where it is.
 */
export function InlineText({ text }: { text: string }) {
  return (
    <>
      {splitInline(text).map((part, i) =>
        part.bold ? (
          <strong key={i}>{part.text}</strong>
        ) : part.italic ? (
          <em key={i}>{part.text}</em>
        ) : part.code ? (
          <code key={i}>{part.text}</code>
        ) : (
          <Fragment key={i}>{part.text}</Fragment>
        ),
      )}
    </>
  )
}
