'use client'

import { useState } from 'react'

/** This chat's concepts inside a highlight, as the forget-match route answers (Q26); 'loading' while it is asked. */
export type ChipConcepts = 'loading' | { key: string; label: string }[]

/**
 * The chip by a highlighted part of a message (reply-to ticket 03, Q15, Q24).
 *
 * Reply quotes the highlighted part. Forget is offered only on your own
 * messages (Q28), so `forget` is absent for a model reply. It opens the
 * existing forget dialog for a concept inside the highlight:
 *  - none: shown disabled, with the hint, not hidden (Q27);
 *  - one: straight to the dialog;
 *  - several: a short list first, because forgetting has no undo and the
 *    person always picks exactly one (Q29).
 *
 * Pressing the chip must not clear the highlight under it, so mousedown is
 * stopped. It is placed after the message's text in the page, so Tab from a
 * keyboard selection reaches it.
 */
export function QuoteChip({
  at,
  forget,
  onReply,
  onForget,
}: {
  /** Where it sits, in viewport pixels. */
  at: { top: number; left: number }
  forget?: ChipConcepts
  onReply: () => void
  onForget: (key: string) => void
}) {
  const [picking, setPicking] = useState(false)
  const found = forget === undefined || forget === 'loading' ? null : forget
  const none = found !== null && found.length === 0

  return (
    <div
      className="quote-chip"
      role="toolbar"
      aria-label="Highlighted text"
      style={{ top: at.top, left: at.left }}
      onMouseDown={(e) => e.preventDefault()}
    >
      <button className="quote-chip-btn" onClick={onReply}>Reply</button>
      {forget !== undefined && (picking && found && found.length > 1 ? (
        <>
          <span className="quote-chip-label">Forget:</span>
          {found.map((c) => (
            <button key={c.key} className="quote-chip-btn" onClick={() => onForget(c.key)}>{c.label}</button>
          ))}
        </>
      ) : (
        <>
          <button
            className="quote-chip-btn"
            aria-disabled={!found || none}
            aria-busy={forget === 'loading'}
            aria-describedby={none ? 'quote-chip-hint' : undefined}
            title={none ? 'Nothing in memory matches this' : undefined}
            onClick={() => {
              if (!found || none) return
              if (found.length === 1) onForget(found[0].key)
              else setPicking(true)
            }}
          >
            Forget
          </button>
          {none && <span id="quote-chip-hint" className="quote-chip-hint">Nothing in memory matches this</span>}
        </>
      ))}
    </div>
  )
}
