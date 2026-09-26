'use client'

import { useEffect, useRef, useState } from 'react'
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
  onChatsChanged,
}: {
  activeChatId: string | null
  /** Open a conversation from its card. Without it the card is a dead end. */
  onOpenChat?: (id: string) => void
  /**
   * Ask for the chat list again. Forgetting changes a chat's concept count,
   * which the sidebar shows, as the `/forget` path in chat already does.
   */
  onChatsChanged: () => void
}) {
  const { graph, loading, error, reload } = useGraph()
  /**
   * The concept whose × was pressed, and the chat whose card it was on.
   * null while no forget confirmation is open.
   */
  const [forgetting, setForgetting] = useState<{ chatId: string; key: string } | null>(null)
  /**
   * Set when a concept has just been forgotten: which card it was on, and the
   * graph that was on screen then. Kept in a ref because it only steers the
   * effect below and should not cause a render of its own.
   */
  const refocus = useRef<{ chatId: string; graph: typeof graph } | null>(null)
  /** The error screen's heading, so focus has somewhere to land (see below). */
  const errorHeading = useRef<HTMLHeadingElement>(null)

  // Put keyboard focus back somewhere sensible after a forget. The × that
  // opened the dialog is removed when the reloaded graph draws the card
  // without that chip, and the browser then drops focus to the page. So wait
  // until the dialog is closed AND a new graph has been drawn, and only step
  // in if focus really was lost: on the card's title button, or else the card.
  //
  // One exception comes first. If the forget worked but the reload after it
  // failed, the graph never changes and the whole Archive (every card, and
  // the dialog) is swapped for the error screen, which takes focus with it.
  // Then focus goes to that screen's heading, so the keyboard is not left
  // stranded at the top of the page.
  useEffect(() => {
    const pending = refocus.current
    if (!pending) return
    if (error) {
      refocus.current = null
      errorHeading.current?.focus()
      return
    }
    if (forgetting || graph === pending.graph) return
    refocus.current = null
    const active = document.activeElement
    if (active && active !== document.body) return
    const card = document.querySelector<HTMLElement>(
      `.arc-card[data-chat-id="${CSS.escape(pending.chatId)}"]`,
    )
    // If the card itself is gone there is nothing better to offer; leave it.
    if (!card) return
    ;(card.querySelector<HTMLElement>('button.arc-title') ?? card).focus()
  }, [graph, forgetting, error])

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
        {/* tabIndex -1: code can focus it (after a failed reload), Tab cannot. */}
        <h2 ref={errorHeading} tabIndex={-1}>
          The archives could not be read
        </h2>
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
          count drops (and the effect above moves focus onto the card). */}
      {forgetting && (
        <ForgetDialog
          key={`${forgetting.chatId}:${forgetting.key}`}
          chatId={forgetting.chatId}
          conceptKey={forgetting.key}
          onForgotten={() => {
            refocus.current = { chatId: forgetting.chatId, graph }
            reload()
            onChatsChanged()
          }}
          onClose={() => setForgetting(null)}
        />
      )}
    </>
  )
}
