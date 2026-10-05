'use client'

import { useEffect, useRef, useState } from 'react'
import { AlertCircle } from 'lucide-react'

/**
 * The confirmation for deleting one turn (message-actions ticket 01, Q11):
 * a message and its reply, from the chat and from memory. Built on
 * ForgetDialog's pattern — same scrim and card, Escape and a click outside
 * close it, Tab stays inside, focus returns to the opener — and, as there,
 * the first focus lands on Cancel, so Enter cannot destroy.
 *
 * A 404 means the server does not have this message: deleted in another tab,
 * or a message sent from a tab that was open before this feature shipped.
 * Either way a retry can never work, so the dialog says it is already gone
 * and offers Close only.
 */
export function DeleteTurnDialog({
  chatId,
  messageId,
  hasReply,
  onDeleted,
  onClose,
}: {
  chatId: string
  messageId: string
  hasReply: boolean
  onDeleted: (ids: string[]) => void
  onClose: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const [gone, setGone] = useState(false)
  const card = useRef<HTMLDivElement>(null)
  const cancel = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    cancel.current?.focus()
    return () => {
      // After a successful delete the opener (the trash button of the removed
      // message) is no longer in the page; focus the composer instead of <body>.
      if (opener?.isConnected) opener.focus()
      else document.getElementById('chat-composer')?.focus()
    }
  }, [])

  // Cancel is `disabled` while busy, and the "already gone" render removes the
  // Delete button that held focus. Focusing right after setBusy(false) would run
  // before React re-renders, so wait for the render where busy turns false.
  const wasBusy = useRef(false)
  useEffect(() => {
    if (wasBusy.current && !busy) cancel.current?.focus()
    wasBusy.current = busy
  }, [busy])

  function requestClose() {
    if (!busy) onClose()
  }

  async function remove() {
    if (busy) return
    setBusy(true)
    setFailed(false)
    try {
      const res = await fetch(`/api/sessions/${chatId}/messages/${messageId}`, { method: 'DELETE' })
      if (res.ok) {
        onDeleted(((await res.json()) as { deleted: string[] }).deleted)
        onClose()
        return
      }
      if (res.status === 404) setGone(true)
      else setFailed(true)
    } catch {
      setFailed(true)
    }
    setBusy(false)
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'Escape') {
      event.stopPropagation()
      requestClose()
      return
    }
    if (event.key === 'Tab' && card.current) {
      const items = card.current.querySelectorAll<HTMLElement>('button:not(:disabled)')
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
        className="core forget"
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-turn-title"
        aria-describedby={gone ? undefined : 'delete-turn-what'}
        aria-busy={busy || undefined}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        {gone ? (
          <p id="delete-turn-title" className="forget-status is-final" role="status">
            This message is already gone. Reload the chat to see it as it is now.
          </p>
        ) : (
          <>
            <h2 id="delete-turn-title">{hasReply ? 'Delete this message and its reply?' : 'Delete this message?'}</h2>
            <ul id="delete-turn-what" className="forget-notes">
              <li>It will also be removed from memory, so no chat can use it again.</li>
              <li>Replies in other chats that already used it are not changed.</li>
            </ul>
            {failed && (
              <p className="composer-failed forget-failed" role="alert">
                <AlertCircle size={13} aria-hidden="true" />
                <span>Couldn’t delete it. Try again.</span>
              </p>
            )}
          </>
        )}

        <div className="core-foot">
          <div className="core-actions">
            <button ref={cancel} className="tour-back" onClick={requestClose} disabled={busy}>
              {gone ? 'Close' : 'Cancel'}
            </button>
            {!gone && (
              <span className="forget-pair">
                <button
                  className="forget-go"
                  onClick={remove}
                  // Not `disabled` while the request runs: that would throw
                  // focus out of the dialog. `remove()` ignores a second press.
                  aria-disabled={busy || undefined}
                >
                  Delete
                </button>
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
