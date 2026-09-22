'use client'

import { useEffect, useRef, useState } from 'react'
import { Pencil, Trash2 } from 'lucide-react'

/**
 * The menu on a chat row.
 *
 * Opened by right-click, which is what someone reaches for on a list like
 * this, and by the `···` on the row, which is the same menu for everyone who
 * does not — a right-click has no discoverable affordance and no equivalent on
 * a touch screen, so it cannot be the only way in.
 *
 * Both actions resolve IN the menu rather than in a dialog over the page.
 * Rename opens a field on the spot; delete asks a second time in place. Not
 * `window.confirm` or `window.prompt`: they block the page, cannot be styled,
 * and read as something the browser is doing rather than something the app is.
 *
 * Positioned in the viewport at the pointer, which is where the menu belongs
 * when a right-click opened it; the `···` passes its own corner instead.
 */

export type MenuAt = { id: string; title: string; x: number; y: number }

const WIDTH = 216

type Step = 'menu' | 'renaming' | 'confirming'

export function ChatMenu({
  at,
  onRename,
  onDelete,
  onClose,
}: {
  at: MenuAt
  onRename?: (id: string, title: string) => void
  onDelete: (id: string) => void
  onClose: () => void
}) {
  const [step, setStep] = useState<Step>('menu')
  const [name, setName] = useState(at.title)
  const card = useRef<HTMLDivElement>(null)
  const field = useRef<HTMLInputElement>(null)

  useEffect(() => {
    card.current?.focus()
  }, [])

  // Selected, not just focused: renaming usually means replacing, and the
  // alternative is making someone clear a field before they can start.
  useEffect(() => {
    if (step === 'renaming') field.current?.select()
  }, [step])

  useEffect(() => {
    const close = () => onClose()

    /**
     * Close on a press OUTSIDE the menu — decided by where the press landed,
     * not by asking React to stop it.
     *
     * This listener runs in the capture phase on `window`, which is before
     * every React handler: React attaches at the root and this fires above it.
     * So `onPointerDown={e => e.stopPropagation()}` on the card cannot save
     * its own clicks, and the first version did exactly that. Pressing
     * "Delete chat" with a real mouse unmounted the menu on `pointerdown` and
     * the `click` then had nothing to land on — the item did nothing, every
     * time. It passed a check that called `.click()` directly, which sends no
     * pointerdown at all. A synthetic click is not a mouse.
     */
    function onPointerDown(event: PointerEvent) {
      if (card.current?.contains(event.target as Node)) return
      onClose()
    }

    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }

    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onPointerDown, true)
    // A menu pinned to viewport coordinates lies the moment the list moves.
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [onClose])

  // Kept inside the viewport: opened near the bottom or the right edge, a menu
  // that simply takes the pointer's coordinates renders half off-screen.
  const left = Math.min(at.x, window.innerWidth - WIDTH - 8)
  const top = Math.min(at.y, window.innerHeight - 150)

  const ready = name.trim().length > 0 && name.trim() !== at.title

  function save() {
    if (!ready || !onRename) return
    onRename(at.id, name.trim())
    onClose()
  }

  return (
    <div
      ref={card}
      className="chat-menu"
      role="menu"
      aria-label={`Actions for ${at.title}`}
      tabIndex={-1}
      style={{ left, top, width: WIDTH }}
      // A right-click inside the menu should not open the browser's own.
      onContextMenu={(e) => e.preventDefault()}
    >
      {step !== 'renaming' && <p className="chat-menu-head">{at.title}</p>}

      {step === 'menu' && (
        <>
          {onRename && (
            <button className="chat-menu-item" role="menuitem" onClick={() => setStep('renaming')}>
              <Pencil size={13} aria-hidden="true" />
              Rename
            </button>
          )}
          <button
            className="chat-menu-item is-danger"
            role="menuitem"
            onClick={() => setStep('confirming')}
          >
            <Trash2 size={13} aria-hidden="true" />
            Delete chat
          </button>
        </>
      )}

      {step === 'renaming' && (
        <div className="chat-rename">
          <label className="sr-only" htmlFor="chat-rename-field">
            New name for this conversation
          </label>
          <input
            ref={field}
            id="chat-rename-field"
            value={name}
            maxLength={120}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                save()
              }
              // Back to the menu rather than out of it: Escape here undoes the
              // rename you started, not the menu you opened on purpose.
              if (e.key === 'Escape') {
                e.preventDefault()
                e.stopPropagation()
                setName(at.title)
                setStep('menu')
              }
            }}
          />
          <div className="chat-rename-row">
            <button className="chat-menu-item" onClick={() => setStep('menu')}>
              Cancel
            </button>
            <button className="chat-rename-save" disabled={!ready} onClick={save}>
              Save
            </button>
          </div>
        </div>
      )}

      {step === 'confirming' && (
        <>
          <p className="chat-menu-warn">
            Its messages and its memory go with it. This cannot be undone.
          </p>
          <button
            className="chat-menu-item is-danger"
            role="menuitem"
            onClick={() => {
              onDelete(at.id)
              onClose()
            }}
          >
            <Trash2 size={13} aria-hidden="true" />
            Delete for good
          </button>
          <button className="chat-menu-item" role="menuitem" onClick={() => setStep('menu')}>
            Keep it
          </button>
        </>
      )}
    </div>
  )
}
