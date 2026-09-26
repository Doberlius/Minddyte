'use client'

import { useState } from 'react'
import { ArchiveView } from './ArchiveView'
import { useGraph } from '@/components/graph/useGraph'
import { ForgetDialog } from '@/components/forget/ForgetDialog'

/**
 * The Memory Archives, over the real database.
 *
 * Every conversation, shown by what has been indexed from it rather than by
 * a fixed memory. Under read-time pointers the assistant picks its passages
 * fresh at question time, so there is no one digest to preview — this panel
 * shows how much of each conversation is indexed instead.
 *
 * It is also the second way to forget a concept (ticket 10, Q3): the × on a
 * chip opens the same confirmation the `/forget` command opens in chat.
 */
export function MemoryArchives({
  activeChatId,
  onOpenChat,
}: {
  activeChatId: string | null
  /** Open a conversation from its card. Without it the card is a dead end. */
  onOpenChat?: (id: string) => void
}) {
  const { graph, loading, error, reload } = useGraph()
  /**
   * The concept whose × was pressed, and the chat whose card it was on.
   * null while no forget confirmation is open.
   */
  const [forgetting, setForgetting] = useState<{ chatId: string; key: string } | null>(null)

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
        <h2>No chats yet</h2>
        <p>Send a message and it shows up here.</p>
      </div>
    )
  }

  return (
    <>
      <ArchiveView
        graph={graph}
        highlight={activeChatId ? [activeChatId] : []}
        highlightLabel="the chat you have open"
        onOpen={onOpenChat}
        onForget={(chatId, key) => setForgetting({ chatId, key })}
      />
      {/* Keyed by chat and concept, so each × starts a fresh dialog rather
          than reusing the last one's state. Once something is forgotten the
          graph is fetched again, so the chip goes and the card's sentence
          count drops. */}
      {forgetting && (
        <ForgetDialog
          key={`${forgetting.chatId}:${forgetting.key}`}
          chatId={forgetting.chatId}
          conceptKey={forgetting.key}
          onForgotten={reload}
          onClose={() => setForgetting(null)}
        />
      )}
    </>
  )
}
