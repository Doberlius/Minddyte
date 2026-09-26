'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { GraphNode, ViewGraph } from '@/types/graph'

/**
 * The `/forget` list: the concepts in THIS chat, one of which you can stop
 * being used as memory (ticket 10, Q3/Q10/Q16).
 *
 * Laid out exactly like the `@` picker (the same `.picker` shell, a name on
 * the left and a short note on the right), but red. The two would otherwise
 * be identical, and one loads memory while the other destroys it (spec §5.1),
 * so the colour is what tells them apart at a glance.
 *
 * Picking a row does not forget anything yet. It hands the concept's key to
 * the chat screen, which opens the full confirmation (`ForgetDialog`).
 *
 * How it works, in order:
 *   1. When it opens, it asks the server for the whole concept graph
 *      (`GET /api/graph`) and keeps only the concepts this chat holds.
 *      A new chat with no id yet has none, so it skips the request.
 *   2. The keyboard works like the `/` picker: ↑/↓ move, Enter picks,
 *      Esc closes. Focus never leaves the message box; the list listens to
 *      the whole window instead.
 */

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; concepts: GraphNode[] }
  /** The list could not be read (network down, server error). */
  | { kind: 'broken' }

export function ForgetPicker({
  chatId,
  onPick,
  onDismiss,
}: {
  /** The open chat. null or undefined for a new chat that has no id yet. */
  chatId: string | null | undefined
  /** Gets the concept's canonical key, which is what the forget API takes. */
  onPick: (key: string) => void
  onDismiss: () => void
}) {
  // A new chat has nothing to forget, so it starts (and stays) "ready, empty".
  const [state, setState] = useState<State>(chatId ? { kind: 'loading' } : { kind: 'ready', concepts: [] })
  const [at, setAt] = useState(0)
  const panel = useRef<HTMLDivElement>(null)

  // Step 1: load this chat's concepts. The AbortController stops a slow
  // answer from updating a picker that has already been closed.
  useEffect(() => {
    if (!chatId) {
      setState({ kind: 'ready', concepts: [] })
      return
    }
    setState({ kind: 'loading' })
    const abort = new AbortController()
    fetch('/api/graph', { signal: abort.signal })
      .then((res) => (res.ok ? (res.json() as Promise<ViewGraph>) : Promise.reject(new Error('graph'))))
      .then((graph) => {
        const concepts = graph.nodes
          .filter((n) => n.chatIds.includes(chatId))
          // Alphabetical, so a long list can be scanned for a name.
          .sort((a, b) => a.label.localeCompare(b.label))
        setState({ kind: 'ready', concepts })
        setAt(0)
      })
      .catch(() => {
        if (!abort.signal.aborted) setState({ kind: 'broken' })
      })
    return () => abort.abort()
  }, [chatId])

  // Memoised so the keyboard effect below is not torn down and re-added on
  // every render while the list is loading (a fresh [] each time).
  const list = useMemo(() => (state.kind === 'ready' ? state.concepts : []), [state])

  // Step 2: the keyboard. Capture phase, and stopped here, because the
  // message box below sends on Enter.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onDismiss()
        return
      }
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
        event.preventDefault()
        event.stopPropagation()
        onPick(list[Math.min(at, list.length - 1)].key)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [list, at, onPick, onDismiss])

  // A chat can hold dozens of concepts, more than the panel shows at once, so
  // the highlighted row is scrolled into view as the arrows move it.
  useEffect(() => {
    panel.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [at])

  if (state.kind !== 'ready' || list.length === 0) {
    return (
      <div className="picker is-forget">
        <div className="picker-head">Forget in this chat</div>
        <p className="picker-empty" role="status">
          {state.kind === 'loading' && 'Reading this chat…'}
          {state.kind === 'broken' && 'Couldn’t read this chat’s concepts. Press Esc and try /forget again.'}
          {state.kind === 'ready' && 'This chat has no concepts yet.'}
        </p>
      </div>
    )
  }

  return (
    <div ref={panel} className="picker is-forget" role="listbox" aria-label="Forget in this chat">
      <div className="picker-head">Forget in this chat</div>
      {list.map((c, i) => (
        <div
          key={c.key}
          className={`forget-row${i === at ? ' hi' : ''}`}
          role="option"
          aria-selected={i === at}
          onMouseEnter={() => setAt(i)}
          // Keep focus in the message box. A click on a plain row would
          // otherwise drop it to the page, and the dialog that opens next
          // hands focus back to wherever it was when it opened.
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onPick(c.key)}
        >
          <span className="t">{c.label}</span>
          <span className="m">stops it being recalled from this chat</span>
        </div>
      ))}
    </div>
  )
}
