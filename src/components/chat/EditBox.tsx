'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * Editing one of your own messages in place (message-actions ticket 02).
 * Saving cuts this message and everything after it and asks the model again
 * (Q2); when that cuts more than this message's own reply, a line says how
 * much (Q8). Enter saves, Shift+Enter is a new line, Escape cancels — the
 * composer's own keys. Save waits for a change: an unchanged question is a
 * regenerate, which the reply's own button does.
 */
export function EditBox({
  original,
  draft,
  removes,
  onSave,
  onCancel,
}: {
  original: string
  draft: string
  removes: number
  onSave: (text: string) => void
  onCancel: () => void
}) {
  const [text, setText] = useState(draft)
  const box = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const el = box.current
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [])

  const clean = text.trim()
  const changed = clean !== '' && clean !== original.trim()

  return (
    <div className="msg-edit">
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
            if (changed) onSave(clean)
          }
        }}
      />
      {removes > 1 && <p id="msg-edit-note" className="msg-edit-note">Saving will remove the {removes} messages after this one.</p>}
      <div className="msg-edit-actions">
        <button className="tour-back" onClick={onCancel}>Cancel</button>
        <button className="btn-send" onClick={() => changed && onSave(clean)} disabled={!changed}>Save</button>
      </div>
    </div>
  )
}
