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
 * A failed fetch leaves `graph` empty and `error` set. It must not throw: the
 * chat still works when the graph cannot be read, and taking the whole page
 * down over a panel is a worse outcome than the panel saying so.
 */
export function useGraph() {
  const [graph, setGraph] = useState<ViewGraph>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false

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
  }, [])

  return { graph, loading, error }
}
