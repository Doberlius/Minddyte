'use client'

import { BrainView } from '@/components/graph/BrainView'
import { useGraph } from '@/components/graph/useGraph'

/**
 * The Neural Brain, over the real database.
 *
 * The canvas, the layout and the legend are the same components the demo
 * runs — there is one implementation, and this hands it rows from PGlite
 * where the demo hands it arrays from memory.
 *
 * The open conversation is what gets filled in. In the demo the fill means
 * "one you started", because there it distinguishes your work from the five
 * that were seeded. Here every conversation is yours, so the useful question
 * is which one you are in.
 */
export function NeuralBrain({ activeChatId }: { activeChatId: string | null }) {
  const { graph, loading, error } = useGraph()

  if (loading) {
    return (
      <div className="view-empty">
        <p>Reading the graph…</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="view-empty">
        <h2>The graph could not be read</h2>
        <p>Your conversations are unaffected. Reload to try again.</p>
      </div>
    )
  }

  if (graph.chats.length === 0) {
    return (
      <div className="view-empty">
        <h2>Nothing to draw yet</h2>
        <p>Concepts appear here as you talk. Name a tool in a chat and it lands on this canvas.</p>
      </div>
    )
  }

  return (
    <BrainView
      graph={graph}
      highlight={activeChatId ? [activeChatId] : []}
      highlightLabel="the chat you have open"
      focusId={activeChatId}
      // The pulse marks concepts from a message just sent, which is a thing
      // only the demo can know the instant it happens.
      newKeys={[]}
    />
  )
}
