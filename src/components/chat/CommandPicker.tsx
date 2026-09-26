'use client'

import { useEffect, useState } from 'react'
import { Crosshair, Eraser, HelpCircle, Waypoints } from 'lucide-react'
import { matchCommands, type ChatMode, type HelpEntry } from './commands'

/**
 * The `/` command list.
 *
 * `@` brings a conversation in; `/` changes how this message is sent, or
 * (for `/help`) opens the full list. Both are typed into the same box and
 * both open a panel above it, because a control you reach by typing should
 * not send you hunting for a button — the pill by the Send button stays, and
 * this is the same setting by the other route.
 *
 * Anchored to the START of the message. `@` can appear anywhere in a sentence
 * because it names a thing inside what you are saying; a command is not part
 * of a sentence, it is instead of one.
 *
 * Keyboard-first, unlike the `@` picker it sits beside: a list you opened from
 * the keyboard and must then reach for the mouse to use is worse than no list.
 * `.cmd-row` and its `.hi` state were already in the design system waiting for
 * exactly this.
 *
 * The rows themselves come from `./commands` — the one list shared with the
 * /help card (ticket 08, Q10), so this menu and that card can never disagree.
 */

const ICONS: Record<string, React.ReactNode> = {
  'mode explore': <Waypoints size={14} />,
  'mode focus': <Crosshair size={14} />,
  forget: <Eraser size={14} />,
  help: <HelpCircle size={14} />,
}

export function CommandPicker({
  query,
  mode,
  onPick,
  onDismiss,
}: {
  /** What follows the slash, which may be empty. */
  query: string
  mode: ChatMode
  onPick: (entry: HelpEntry) => void
  onDismiss: () => void
}) {
  const list = matchCommands(query)
  const [at, setAt] = useState(0)

  // A filter that shortens the list can leave the highlight past its end.
  const index = Math.min(at, Math.max(list.length - 1, 0))

  useEffect(() => {
    setAt(0)
  }, [query])

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      // Escape dismisses the picker even with no match on screen — the panel
      // is still open, and Escape closing it is true regardless of what it
      // holds.
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onDismiss()
        return
      }
      // Nothing matches (e.g. "/why is this slow"): Enter falls through to the
      // box below and sends it as an ordinary message, as Send would. Doing
      // nothing here trapped the person with no way to send what they typed
      // (whole-branch review 2, finding 4).
      if (list.length === 0) return
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        event.stopPropagation()
        setAt((i) => {
          const next = event.key === 'ArrowDown' ? i + 1 : i - 1
          return (next + list.length) % list.length
        })
        return
      }
      if (event.key === 'Enter' && !event.shiftKey) {
        // Capture, and stopped here: the box below sends on Enter, and a
        // command list that submits your half-typed slash instead of running
        // the command is worse than not offering the list.
        event.preventDefault()
        event.stopPropagation()
        onPick(list[index])
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [list, index, onPick, onDismiss])

  if (list.length === 0) {
    return (
      <div className="picker">
        <div className="picker-head">Commands</div>
        <p className="picker-empty">
          No command matches “{query}”. Type <code>/help</code> to see all commands, or press Enter to send it as a message.
        </p>
      </div>
    )
  }

  return (
    <div className="picker" role="listbox" aria-label="Commands">
      <div className="picker-head">Commands</div>
      {list.map((c, i) => (
        <div
          key={c.name}
          className={`cmd-row${i === index ? ' hi' : ''}`}
          role="option"
          aria-selected={i === index}
          onMouseEnter={() => setAt(i)}
          onClick={() => onPick(c)}
        >
          <span className="cmd-ic">{ICONS[c.name]}</span>
          <span className="cmd-text">
            <span className="cmd-name">{c.label}</span>
            <span className="cmd-hint">{c.what}</span>
            <span className="cmd-example">{c.example}</span>
          </span>
          {c.action?.kind === 'mode' && c.action.mode === mode && <span className="cmd-now">now</span>}
        </div>
      ))}
    </div>
  )
}
