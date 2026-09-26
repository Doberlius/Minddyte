'use client'

import { useEffect, useState } from 'react'
import type { ViewGraph } from '@/types/graph'

const EMPTY: ViewGraph = { chats: [], nodes: [] }

/**
 * The graph as the database currently holds it.
 *
 * Fetched on mount rather than kept in a store: both views that use it are
 * mounted only while you are looking at them, and the graph changes when a
 * message is sent, which happens on a different tab. Arriving is therefore the
 * exact moment the answer could be stale.
 *
 * A failed fetch leaves `graph` as it was and `error` set. It must not throw: the
 * chat still works when the graph cannot be read, and taking the whole page
 * down over a panel is a worse outcome than the panel saying so.
 *
 * `reload()` asks for the graph again, for when the view itself changed it
 * (forgetting a concept from the Archive). It bumps `version`, which is in the
 * effect's dependency list, so React runs the same fetch once more. The graph
 * already on screen stays there until the new one arrives: `loading` is only
 * true for the very first fetch, so a reload never flashes the loading text.
 */
export function useGraph() {
  const [graph, setGraph] = useState<ViewGraph>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  /** Bumped by `reload()`; changing it re-runs the fetch below. */
  const [version, setVersion] = useState(0)

  useEffect(() => {
    let cancelled = false
    // A new load starts with a clean slate: without this, one failed load
    // would leave the error showing even after a later load succeeds.
    setError(false)

    fetch('/api/graph')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('graph unavailable'))))
      .then((data: ViewGraph) => {
        if (cancelled) return
        setGraph(data)
      })
      .catch(() => {
        if (!cancelled) setError(true)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [version])

  return { graph, loading, error, reload: () => setVersion((v) => v + 1) }
}
