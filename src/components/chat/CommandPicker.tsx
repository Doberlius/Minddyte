'use client'

import { useEffect, useState } from 'react'
import { Crosshair, Waypoints } from 'lucide-react'

/**
 * The `/` command list.
 *
 * `@` brings a conversation in; `/` changes how this message is sent. Both are
 * typed into the same box and both open a panel above it, because a control
 * you reach by typing should not send you hunting for a button — the pill by
 * the Send button stays, and this is the same setting by the other route.
 *
 * Anchored to the START of the message. `@` can appear anywhere in a sentence
 * because it names a thing inside what you are saying; a command is not part
 * of a sentence, it is instead of one.
 *
 * Keyboard-first, unlike the `@` picker it sits beside: a list you opened from
 * the keyboard and must then reach for the mouse to use is worse than no list.
 * `.cmd-row` and its `.hi` state were already in the design system waiting for
 * exactly this.
 */

export type Mode = 'focus' | 'explore'

type Command = {
  /** What you type, without the slash. */
  name: string
  mode: Mode
  label: string
  hint: string
  icon: React.ReactNode
}

const COMMANDS: Command[] = [
  {
    name: 'mode explore',
    mode: 'explore',
    label: '/mode explore',
    hint: 'Also reach conversations that share a concept with this one',
    icon: <Waypoints size={14} />,
  },
  {
    name: 'mode focus',
    mode: 'focus',
    label: '/mode focus',
    hint: 'Reach nothing you did not bring in yourself with @',
    icon: <Crosshair size={14} />,
  },
]

export function CommandPicker({
  query,
  mode,
  onPick,
  onDismiss,
}: {
  /** What follows the slash, which may be empty. */
  query: string
  mode: Mode
  onPick: (mode: Mode) => void
  onDismiss: () => void
}) {
  const q = query.toLowerCase()
  const list = COMMANDS.filter((c) => c.name.startsWith(q) || c.name.includes(q))
  const [at, setAt] = useState(0)

  // A filter that shortens the list can leave the highlight past its end.
  const index = Math.min(at, Math.max(list.length - 1, 0))

  useEffect(() => {
    setAt(0)
  }, [query])

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
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
        onPick(list[index].mode)
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onDismiss()
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
          No command matches “{query}”. The only one so far is{' '}
          <code>/mode</code>.
        </p>
      </div>
    )
  }

  return (
    <div className="picker" role="listbox" aria-label="Commands">
      <div className="picker-head">Commands — changes how this message is sent</div>
      {list.map((c, i) => (
        <div
          key={c.name}
          className={`cmd-row${i === index ? ' hi' : ''}`}
          role="option"
          aria-selected={i === index}
          onMouseEnter={() => setAt(i)}
          onClick={() => onPick(c.mode)}
        >
          <span className="cmd-ic">{c.icon}</span>
          <span className="cmd-text">
            <span className="cmd-name">{c.label}</span>
            <span className="cmd-hint">{c.hint}</span>
          </span>
          {c.mode === mode && <span className="cmd-now">now</span>}
        </div>
      ))}
    </div>
  )
}
