'use client'

import { useState } from 'react'
import { BrainView } from '@/components/graph/BrainView'
import { useGraph } from '@/components/graph/useGraph'
import { ForgetDialog } from '@/components/forget/ForgetDialog'

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
 *
 * Forgetting from the map opens the same confirmation as the `/forget`
 * command, and afterwards the graph is read again so the chip and its line
 * disappear. (The Archive page used to be the other way in; the Brain's
 * panel and list replaced it.)
 */
export function NeuralBrain({
  activeChatId,
  onOpenChat,
  onUseChat,
  onChatsChanged,
}: {
  activeChatId: string | null
  onOpenChat: (id: string) => void
  /** Bring a chat into the next message, as `@` does. */
  onUseChat: (id: string) => void
  /** Forgetting changes a chat's concept count, which the sidebar shows. */
  onChatsChanged: () => void
}) {
  const { graph, loading, error, reload } = useGraph()
  const [forgetting, setForgetting] = useState<{ chatId: string; key: string } | null>(null)

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
    <>
      <BrainView
        graph={graph}
        highlight={activeChatId ? [activeChatId] : []}
        highlightLabel="the chat you have open"
        focusId={activeChatId}
        onOpenChat={onOpenChat}
        onUseChat={onUseChat}
        onForget={(chatId, key) => setForgetting({ chatId, key })}
      />
      {/* Keyed so each × starts a fresh dialog rather than reusing the last one's state. */}
      {forgetting && (
        <ForgetDialog
          key={`${forgetting.chatId}:${forgetting.key}`}
          chatId={forgetting.chatId}
          conceptKey={forgetting.key}
          onForgotten={() => {
            reload()
            onChatsChanged()
          }}
          onClose={() => setForgetting(null)}
        />
      )}
    </>
  )
}
