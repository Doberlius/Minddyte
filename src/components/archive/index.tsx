'use client'

import { ArchiveView } from './ArchiveView'
import { useGraph } from '@/components/graph/useGraph'

/**
 * The Memory Archives, over the real database.
 *
 * Every conversation, shown by what has been indexed from it rather than by
 * a fixed memory. Under read-time pointers the assistant picks its passages
 * fresh at question time, so there is no one digest to preview — this panel
 * shows how much of each conversation is indexed instead.
 */
export function MemoryArchives({
  activeChatId,
  onOpenChat,
}: {
  activeChatId: string | null
  /** Open a conversation from its card. Without it the card is a dead end. */
  onOpenChat?: (id: string) => void
}) {
  const { graph, loading, error } = useGraph()

  if (loading) {
    return (
      <div className="view-empty">
        <p>Reading the archives…</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="view-empty">
        <h2>The archives could not be read</h2>
        <p>Your conversations are unaffected. Reload to try again.</p>
      </div>
    )
  }

  if (graph.chats.length === 0) {
    return (
      <div className="view-empty">
        <h2>No memories yet</h2>
        <p>Each conversation is indexed as you talk, word for word.</p>
      </div>
    )
  }

  return (
    <ArchiveView
      graph={graph}
      highlight={activeChatId ? [activeChatId] : []}
      highlightLabel="the chat you have open"
      onOpen={onOpenChat}
    />
  )
}
