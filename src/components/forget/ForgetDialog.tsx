'use client'

import { useEffect, useRef, useState } from 'react'
import { AlertCircle } from 'lucide-react'
import type { ForgetPreview } from '@/services/forget'

/**
 * The confirmation for forgetting one concept in one chat (ticket 10,
 * Q11/Q12/Q14/Q17). It is the product's only destructive act, so it asks in
 * full: which sentences stop being memory, what stays, and that there is no
 * undo. Both ways in (the `/forget` picker in chat, and the × on a concept
 * chip in the Archive) open this same dialog.
 *
 * It is built on the "About you" editor's dialog (CoreEditor.tsx): the same
 * scrim and card, Escape and a click outside close it, Tab stays inside, and
 * focus goes back to whatever opened it. One difference matters: the first
 * focus lands on Cancel, never on Forget, so pressing Enter cannot destroy.
 *
 * What happens, in order:
 *   1. On open, ask the server what forgetting would hide (GET).
 *   2. Show it. Only the first three sentences at first; "and N more" opens
 *      the rest.
 *   3. Forget sends a POST. Success tells the opener (`onForgotten`) and
 *      closes; a failure keeps the dialog open so the person can try again.
 */

/** How many sentences show before "and N more". */
const FIRST = 3

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; preview: ForgetPreview }
  /** The chat no longer holds this concept (a 404). */
  | { kind: 'gone' }
  /** The preview could not be read at all (network down, server error). */
  | { kind: 'broken' }

export function ForgetDialog({
  chatId,
  conceptKey,
  onClose,
  onForgotten,
}: {
  chatId: string
  conceptKey: string
  onClose: () => void
  onForgotten: () => void
}) {
  const [state, setState] = useState<State>({ kind: 'loading' })
  const [expanded, setExpanded] = useState(false)
  const [forgetting, setForgetting] = useState(false)
  const [failed, setFailed] = useState(false)
  const card = useRef<HTMLDivElement>(null)
  // Cancel and Close are the same button with a different word on it, so the
  // focus it was given on open survives the switch to the "gone" state.
  const cancel = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLUListElement>(null)

  const path = `/api/sessions/${chatId}/forget`

  // Focus starts on Cancel (Enter then means "keep it"), and returns to
  // whatever opened the dialog when it closes.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    cancel.current?.focus()
    return () => opener?.focus?.()
  }, [])

  // Step 1: ask what forgetting would hide. The AbortController stops a slow
  // answer from updating a dialog that has already been closed.
  useEffect(() => {
    const abort = new AbortController()
    fetch(`${path}?key=${encodeURIComponent(conceptKey)}`, { signal: abort.signal })
      .then(async (res) => {
        if (res.status === 404) return setState({ kind: 'gone' })
        if (!res.ok) return setState({ kind: 'broken' })
        setState({ kind: 'ready', preview: (await res.json()) as ForgetPreview })
      })
      .catch(() => {
        if (!abort.signal.aborted) setState({ kind: 'broken' })
      })
    return () => abort.abort()
  }, [path, conceptKey])

  // When a Forget request ends without closing the dialog (it failed, or the
  // concept was already gone), put focus on Cancel/Close. This has to wait
  // for React to draw the new state: until then Cancel is still disabled, so
  // focusing it does nothing, and in the "gone" case the Forget button that
  // holds focus is about to be removed, which would drop focus to the page
  // (where Escape and the Tab trap no longer reach this dialog).
  const wasForgetting = useRef(false)
  useEffect(() => {
    if (wasForgetting.current && !forgetting) cancel.current?.focus()
    wasForgetting.current = forgetting
  }, [forgetting])

  // After "and N more" opens the whole list, move focus onto it so the
  // keyboard can scroll it (the button that had focus is gone).
  useEffect(() => {
    if (expanded) list.current?.focus()
  }, [expanded])

  /** Escape, a click outside, and Cancel/Close all land here. */
  function requestClose() {
    if (forgetting) return
    onClose()
  }

  // Step 3: the destructive act itself.
  async function forget() {
    if (forgetting) return
    setForgetting(true)
    setFailed(false)
    try {
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key: conceptKey }),
      })
      if (res.ok) {
        onForgotten()
        onClose()
        return
      }
      // Already gone (forgotten in another tab, say): say so, rather than
      // inviting a retry that can never work. The opener still hears about
      // it so the view behind can refresh, but the dialog stays open (only
      // Close) so the person reads why nothing more happened.
      if (res.status === 404) {
        setState({ kind: 'gone' })
        onForgotten()
      } else setFailed(true)
    } catch {
      setFailed(true)
    }
    setForgetting(false)
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'Escape') {
      event.stopPropagation()
      requestClose()
      return
    }
    // Keep Tab inside the dialog: the page behind is inert while it is open.
    if (event.key === 'Tab' && card.current) {
      const items = card.current.querySelectorAll<HTMLElement>('button:not(:disabled), [tabindex="0"]')
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

  const ready = state.kind === 'ready' ? state.preview : null
  // Only a loaded preview can be forgotten; "gone" and "broken" offer Close alone.
  const closeOnly = state.kind === 'gone' || state.kind === 'broken'

  return (
    <div className="tour-scrim core-scrim" onClick={requestClose}>
      <div
        ref={card}
        className="core forget"
        role="dialog"
        aria-modal="true"
        aria-labelledby="forget-title"
        aria-describedby={ready ? 'forget-what' : undefined}
        aria-busy={state.kind === 'loading' || forgetting || undefined}
        // As in CoreEditor: a click on the card's own text would otherwise
        // drop focus to the page, where Escape no longer reaches us.
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        {state.kind === 'loading' && (
          <p id="forget-title" className="forget-status" aria-live="polite">
            Reading this chat…
          </p>
        )}
        {state.kind === 'gone' && (
          <p id="forget-title" className="forget-status is-final" role="status">
            This concept is no longer in this chat.
          </p>
        )}
        {state.kind === 'broken' && (
          <p id="forget-title" className="forget-status is-final" role="status">
            Couldn’t read this chat. Close this and try again.
          </p>
        )}

        {ready && (
          <>
            <h2 id="forget-title">Forget “{ready.label}” in this chat?</h2>

            {ready.total === 0 ? (
              <p id="forget-what" className="core-what">
                No sentences mention it; it will only stop linking this chat.
              </p>
            ) : (
              <>
                <p id="forget-what" className="core-what">
                  These sentences will never be used as memory again:
                </p>
                <ul
                  id="forget-sentences"
                  ref={list}
                  className={`forget-quotes${expanded ? ' is-open' : ''}`}
                  // Scrollable once open, so it must be reachable by keyboard.
                  tabIndex={expanded ? 0 : undefined}
                  aria-label={expanded ? 'Every sentence that will be forgotten' : undefined}
                >
                  {(expanded ? ready.sentences : ready.sentences.slice(0, FIRST)).map((sentence, i) => (
                    <li key={i}>{sentence}</li>
                  ))}
                  {expanded && ready.total > ready.sentences.length && (
                    <li className="forget-unshown">
                      …and {(ready.total - ready.sentences.length).toLocaleString('en-US')} more not shown.
                    </li>
                  )}
                </ul>
                {!expanded && ready.total > FIRST && (
                  <button
                    className="forget-more"
                    aria-expanded={false}
                    aria-controls="forget-sentences"
                    onClick={() => setExpanded(true)}
                  >
                    and {(ready.total - FIRST).toLocaleString('en-US')} more
                  </button>
                )}
              </>
            )}

            <ul className="forget-notes">
              <li>The messages stay in this chat, and you can still read them.</li>
              <li>While you are in this chat, the conversation itself is still used.</li>
              {ready.otherChats > 0 && (
                <li>
                  “{ready.label}” stays in your {ready.otherChats.toLocaleString('en-US')} other{' '}
                  {ready.otherChats === 1 ? 'chat' : 'chats'}.
                </li>
              )}
            </ul>

            {failed && (
              <p className="composer-failed forget-failed" role="alert">
                <AlertCircle size={13} aria-hidden="true" />
                <span>Couldn’t forget it. Try again.</span>
              </p>
            )}
          </>
        )}

        <div className="core-foot">
          <div className="core-actions">
            <button ref={cancel} className="tour-back" onClick={requestClose} disabled={forgetting}>
              {closeOnly ? 'Close' : 'Cancel'}
            </button>
            {!closeOnly && (
              <span className="forget-pair">
                <span id="forget-noundo" className="forget-noundo">
                  No undo
                </span>
                <button
                  className="forget-go"
                  onClick={forget}
                  disabled={!ready}
                  // Not `disabled` while the request runs: that would throw
                  // focus out of the dialog. `forget()` ignores a second press.
                  aria-disabled={forgetting || undefined}
                  aria-describedby="forget-noundo"
                >
                  Forget
                </button>
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
