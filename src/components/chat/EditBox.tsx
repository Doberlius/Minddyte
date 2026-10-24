'use client'

import { useEffect, useRef, useState } from 'react'
import { QuoteLine } from './QuoteLine'
import type { QuoteRef } from '@/lib/quote'

/**
 * Editing one of your own messages in place (message-actions ticket 02).
 * Saving cuts this message and everything after it and asks the model again
 * (Q2); when that cuts more than this message's own reply, a line says how
 * much (Q8). Enter saves, Shift+Enter is a new line, Escape cancels — the
 * composer's own keys. Save waits for a change: an unchanged question is a
 * regenerate, which the reply's own button does.
 *
 * A quoted message keeps its quote (reply-to Q23) unless ✕ removes it here;
 * removing it is a change too, so it can be saved with the text untouched.
 */
export function EditBox({
  original,
  draft,
  removes,
  quote,
  hadQuote,
  onSave,
  onCancel,
}: {
  original: string
  draft: string
  removes: number
  /** The message's quote; `preview` is null when its target was deleted, `markdown` when the target is a model reply. */
  quote: { ref: QuoteRef; preview: string | null; markdown: boolean } | null
  /** Whether the saved message has a quote, so that removing it counts as a change. */
  hadQuote: boolean
  onSave: (text: string, quote: QuoteRef | null) => void
  onCancel: () => void
}) {
  const [text, setText] = useState(draft)
  // Only whether ✕ was pressed is kept here. The quote itself is read from
  // the props on every render, so a quoted turn deleted while this box is
  // open reads "deleted" at once (Q18).
  const [removed, setRemoved] = useState(false)
  const kept = removed ? null : quote
  const box = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const el = box.current
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [])

  const clean = text.trim()
  const changed = clean !== '' && (clean !== original.trim() || (hadQuote && !kept))
  const save = () => changed && onSave(clean, kept?.ref ?? null)

  return (
    <div className="msg-edit">
      {kept && <QuoteLine kind="compose" preview={kept.preview} markdown={kept.markdown} onRemove={() => { setRemoved(true); box.current?.focus() }} />}
      <label className="sr-only" htmlFor="msg-edit-box">Edit your message</label>
      <textarea
        id="msg-edit-box"
        ref={box}
        className="composer-box"
        value={text}
        aria-describedby={removes > 1 ? 'msg-edit-note' : undefined}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            onCancel()
          } else if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            save()
          }
        }}
      />
      {removes > 1 && <p id="msg-edit-note" className="msg-edit-note">Saving will remove the {removes} messages after this one.</p>}
      <div className="msg-edit-actions">
        <button className="tour-back" onClick={onCancel}>Cancel</button>
        <button className="btn-send" onClick={save} disabled={!changed}>Save</button>
      </div>
    </div>
  )
}
