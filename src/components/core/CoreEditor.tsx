'use client'

import { useEffect, useRef, useState } from 'react'
import { validateCore } from '@/lib/core'
import { PROVISIONAL } from '@/lib/provisional'

/**
 * The editor for "About you" (ticket 03, Q7): one short note the AI reads on
 * every answer, and only the person ever changes it.
 *
 * Built on the intro tour's overlay (the same scrim, card and motion), with
 * one rule the tour does not need: what someone typed is never thrown away
 * without asking. Escape or a click outside with changes pending asks first;
 * with nothing changed they simply close. Discard is the one button that
 * throws changes away, and it says so.
 *
 * The limit is checked here as well as on the server, with the same function,
 * so the warning under the box and a rejected save say the same words.
 */

const LIMIT = PROVISIONAL.coreCharLimit
const TEMPLATE = "Name:\nWhat I'm working on:\nLanguages and tools:\nHow I like answers:"

export type SavedCore = { text: string; updatedAt: Date | null }

export function CoreEditor({
  initialText,
  onSaved,
  onClose,
}: {
  initialText: string
  onSaved: (core: SavedCore) => void
  onClose: () => void
}) {
  const [text, setText] = useState(initialText)
  const [saving, setSaving] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const card = useRef<HTMLDivElement>(null)
  const field = useRef<HTMLTextAreaElement>(null)
  const keepEditing = useRef<HTMLButtonElement>(null)

  const dirty = text !== initialText
  const check = validateCore(text)
  const over = !check.ok
  const message = serverError ?? (check.ok ? null : check.message)

  // Focus goes into the box, at the end of what is already there, and comes
  // back to whatever opened the dialog (the sidebar row) when it closes.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    const el = field.current
    if (el) {
      el.focus()
      el.setSelectionRange(el.value.length, el.value.length)
    }
    return () => opener?.focus?.()
  }, [])

  useEffect(() => {
    if (confirming) keepEditing.current?.focus()
  }, [confirming])

  /** Escape and a click outside both land here. */
  function requestClose() {
    if (saving) return
    if (dirty) setConfirming(true)
    else onClose()
  }

  function resume() {
    setConfirming(false)
    field.current?.focus()
  }

  async function save() {
    if (over || saving) return
    setSaving(true)
    setServerError(null)
    try {
      const res = await fetch('/api/core', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        // The text stays in the box: a refused save loses nothing.
        setServerError(data?.error ?? 'That did not save. Try again.')
        setSaving(false)
        return
      }
      onSaved({ text: data.text, updatedAt: data.updatedAt ? new Date(data.updatedAt) : null })
    } catch {
      setServerError('That did not save. Check your connection and try again.')
      setSaving(false)
    }
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'Escape') {
      event.stopPropagation()
      if (confirming) resume()
      else requestClose()
      return
    }
    // Keep Tab inside the dialog: the page behind is inert while it is open.
    if (event.key === 'Tab' && card.current) {
      const items = card.current.querySelectorAll<HTMLElement>('button:not(:disabled), textarea:not(:disabled)')
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
  }

  return (
    <div className="tour-scrim core-scrim" onClick={requestClose}>
      <div
        ref={card}
        className="core"
        role="dialog"
        aria-modal="true"
        aria-labelledby="core-title"
        aria-describedby="core-what"
        // A click on the card's own text would otherwise drop focus to the
        // page body, where Escape no longer reaches this handler.
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <h2 id="core-title">About you</h2>
        <p id="core-what" className="core-what">
          A short note about you. Every answer can use it. Only you can change it.
        </p>

        <label className="sr-only" htmlFor="core-text">
          Your note
        </label>
        <textarea
          id="core-text"
          ref={field}
          className={`core-text${over ? ' is-over' : ''}`}
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setServerError(null)
          }}
          placeholder={TEMPLATE}
          rows={8}
          spellCheck
          aria-invalid={over || undefined}
          aria-describedby="core-count core-msg"
        />

        <div className="core-meta">
          <p id="core-msg" className="core-msg" aria-live="polite">
            {message}
          </p>
          <span id="core-count" className={`core-count tnum${over ? ' is-over' : ''}`}>
            {text.length.toLocaleString('en-US')} / {LIMIT.toLocaleString('en-US')}
          </span>
        </div>

        {confirming ? (
          <div className="core-foot core-confirm" role="group" aria-labelledby="core-confirm-q">
            <p id="core-confirm-q">Discard your changes?</p>
            <div className="core-actions">
              <button ref={keepEditing} className="tour-back" onClick={resume}>
                Keep editing
              </button>
              <button className="core-discard-now" onClick={onClose}>
                Discard
              </button>
            </div>
          </div>
        ) : (
          <div className="core-foot">
            <div className="core-actions">
              <button className="tour-back" onClick={onClose} disabled={saving}>
                Discard
              </button>
              <button className="tour-next" onClick={save} disabled={over || saving || !dirty}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
