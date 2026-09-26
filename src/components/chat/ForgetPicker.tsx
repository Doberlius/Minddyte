'use client'

import { Search } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { GraphNode, ViewGraph } from '@/types/graph'
import { searchConcepts, type ConceptMatch } from '@/lib/concept-search'

/**
 * The `/forget` list: the concepts in THIS chat, one of which you can stop
 * being used as memory (ticket 10, Q3/Q10/Q16).
 *
 * Laid out like the `@` picker (the same `.picker` shell, a name on the left
 * and a short note on the right), but red. The two would otherwise be
 * identical, and one loads memory while the other destroys it (spec §5.1),
 * so the colour is what tells them apart at a glance.
 *
 * Picking a row does not forget anything yet. It hands the concept's key to
 * the chat screen, which opens the full confirmation (`ForgetDialog`).
 *
 * How it works, in order:
 *   1. When it opens, it asks the server for the whole concept graph
 *      (`GET /api/graph`) and keeps only the concepts this chat holds.
 *      A new chat with no id yet has none, so it skips the request.
 *   2. A search field at the top takes focus, because a chat built from a
 *      pasted essay can hold 50+ concepts and scrolling for one name is slow.
 *      Typing narrows the list (src/lib/concept-search.ts): names that start
 *      with the text first, the matching letters marked.
 *   3. The keyboard: ↑/↓ move, Enter picks, Esc clears the search and a
 *      second Esc closes. Focus goes back to the message box on the way out,
 *      so the confirmation that opens next returns it there too.
 */

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; concepts: GraphNode[] }
  /** The list could not be read (network down, server error). */
  | { kind: 'broken' }

/** The name with the typed letters marked, so the eye finds why it matched. */
function Name({ match }: { match: ConceptMatch<GraphNode> }) {
  const label = match.item.label
  if (!match.at) return <>{label}</>
  const { start, end } = match.at
  return (
    <>
      {label.slice(0, start)}
      <mark>{label.slice(start, end)}</mark>
      {label.slice(end)}
    </>
  )
}

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
  const [query, setQuery] = useState('')
  const [at, setAt] = useState(0)
  const panel = useRef<HTMLDivElement>(null)
  const field = useRef<HTMLInputElement>(null)
  // Whatever had focus when the picker opened (the message box). The search
  // field borrows focus; leaving hands it back.
  const opener = useRef<Element | null>(null)

  useEffect(() => {
    opener.current = document.activeElement
  }, [])

  const leave = useCallback((then: () => void) => {
    if (opener.current instanceof HTMLElement) opener.current.focus()
    then()
  }, [])

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

  const all = useMemo(() => (state.kind === 'ready' ? state.concepts : []), [state])
  const list = useMemo(() => searchConcepts(all, query, (c) => c.label), [all, query])
  const searchable = all.length > 0

  // Step 2: once there is something to search, the field takes focus.
  useEffect(() => {
    if (searchable) field.current?.focus()
  }, [searchable])

  // Step 3: the keyboard. Capture phase, and stopped here, because the
  // message box below sends on Enter.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        if (query) {
          setQuery('')
          setAt(0)
        } else leave(onDismiss)
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
        const key = list[Math.min(at, list.length - 1)].item.key
        leave(() => onPick(key))
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [list, at, query, onPick, onDismiss, leave])

  // A chat can hold dozens of concepts, more than the panel shows at once, so
  // the highlighted row is scrolled into view as the arrows move it.
  useEffect(() => {
    panel.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [at, query])

  if (!searchable) {
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

  const active = list.length > 0 ? `forget-opt-${Math.min(at, list.length - 1)}` : undefined

  return (
    <div ref={panel} className="picker is-forget">
      <div className="forget-top">
        <div className="picker-head">
          <span>Forget in this chat</span>
          <span className="forget-tally tnum" aria-live="polite">
            {query.trim() ? `${list.length} of ${all.length}` : `${all.length}`}
          </span>
        </div>
        <label className="forget-search">
          <Search size={14} aria-hidden="true" />
          <input
            ref={field}
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setAt(0)
            }}
            placeholder="Find a concept"
            aria-label="Find a concept in this chat"
            role="combobox"
            aria-expanded="true"
            aria-controls="forget-options"
            aria-autocomplete="list"
            aria-activedescendant={active}
            autoComplete="off"
            spellCheck={false}
          />
        </label>
      </div>
      {list.length === 0 ? (
        <p className="picker-empty" role="status">
          No concept in this chat matches “{query.trim()}”.
        </p>
      ) : (
        <div id="forget-options" role="listbox" aria-label="Concepts in this chat">
          {list.map((match, i) => (
            <div
              key={match.item.key}
              id={`forget-opt-${i}`}
              className={`forget-row${i === at ? ' hi' : ''}`}
              role="option"
              aria-selected={i === at}
              onMouseEnter={() => setAt(i)}
              // Keep focus in the search field; the row is not a focus stop.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => leave(() => onPick(match.item.key))}
            >
              <span className="t">
                <Name match={match} />
              </span>
              {/* Where the effect is: OTHER chats. The chat you are in still
                  reads its own conversation (ticket 10, Q14), so "stops it
                  being recalled" read as the opposite of what happens. */}
              <span className="m">other chats can’t pull it from here</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
