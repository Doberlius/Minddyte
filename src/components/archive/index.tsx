'use client'

import { ArchiveView } from './ArchiveView'
import { useGraph } from '@/components/graph/useGraph'

/**
 * The Memory Archives, over the real database.
 *
 * Every conversation's compaction — the memory it would hand the assistant if
 * it were tagged into another one. Those sentences are written by
 * `lib/compaction` on every message, so this panel reads something the app has
 * been building all along and had no way to show.
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
        <p>Each conversation builds one as you talk, from your own sentences.</p>
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
