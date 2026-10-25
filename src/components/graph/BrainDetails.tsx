'use client'

import { useState } from 'react'
import { ArrowUpRight, AtSign, X } from 'lucide-react'
import type { GraphChat, GraphNode } from '@/types/graph'
import type { Selection } from './sigma/brainGraph'

/**
 * What the panel beside a selected card or pill says, and the buttons a
 * canvas node cannot hold.
 *
 * A chat: its size, how much of it is saved for memory, its concepts (shared
 * first), and the two things you can do with it from here: open it, or bring
 * it into your next message the way `@` does. Each concept chip has a × that
 * opens the forget confirmation, the same one `/forget` opens in chat.
 *
 * This panel replaced the Archive page, which showed the same things as a
 * grid of cards; the chip styles (`arc-tag`) are carried over from it.
 *
 * A concept: which chats hold it, each with Open and Forget.
 */

/** Chips before "Show all". A pasted essay can hold hundreds of concepts. */
const CHIPS_SHOWN = 12

export type DetailActions = {
  onSelect: (s: Selection) => void
  onOpenChat: (id: string) => void
  /** Missing when there is nowhere to send it; the button is not shown then. */
  onUseChat?: (id: string) => void
  onForget: (chatId: string, key: string) => void
  onClose: () => void
}

function CloseButton({ onClose }: { onClose: () => void }) {
  return (
    <button type="button" className="brain-panel-x" onClick={onClose} aria-label="Close details" title="Close (Esc)">
      <X size={14} aria-hidden="true" />
    </button>
  )
}

export function ChatDetails({
  chat,
  concepts,
  isOpen,
  openLabel,
  actions,
}: {
  chat: GraphChat
  /** Every concept this chat holds, from the full graph, drawn or not. */
  concepts: GraphNode[]
  /** It is the chat you have open now. */
  isOpen: boolean
  openLabel: string
  actions: DetailActions
}) {
  const [all, setAll] = useState(false)
  const sorted = [...concepts].sort(
    (a, b) => b.chatIds.length - a.chatIds.length || a.label.localeCompare(b.label),
  )
  const shared = sorted.filter((n) => n.chatIds.length > 1).length
  const shown = all ? sorted : sorted.slice(0, CHIPS_SHOWN)
  const title = chat.titleTruncated ? `${chat.title}…` : chat.title

  return (
    <section aria-labelledby="brain-panel-title">
      <CloseButton onClose={actions.onClose} />
      <h3 id="brain-panel-title" className="brain-panel-title" tabIndex={-1}>
        {title}
      </h3>
      <p className="brain-panel-meta tnum">
        {chat.messageCount} message{chat.messageCount === 1 ? '' : 's'} · {concepts.length} concept
        {concepts.length === 1 ? '' : 's'}
        {shared > 0 && (
          <>
            , <span className="brain-panel-hi">{shared} shared</span>
          </>
        )}
        {isOpen && <span className="brain-panel-open"> · {openLabel}</span>}
      </p>
      {/* What the Archive page used to show: how much of this chat retrieval
          can actually draw on (sentences, code blocks and tables). */}
      <p className="brain-panel-meta tnum">
        {chat.passageCount === 0
          ? 'Nothing saved for memory yet'
          : `${chat.passageCount} sentence${chat.passageCount === 1 ? '' : 's'} saved for memory`}
      </p>

      {/* The buttons come before the chips: on a phone the panel is a short
          sheet, and below a dozen chips they were off the bottom of it. */}
      <div className="brain-panel-actions">
        <button type="button" className="btn-send brain-act" onClick={() => actions.onOpenChat(chat.id)}>
          {isOpen ? 'Back to this chat' : 'Open chat'}
          <ArrowUpRight size={13} aria-hidden="true" />
        </button>
        {/* You cannot bring the open chat into itself, which is also what the @ list says. */}
        {!isOpen && actions.onUseChat && (
          <button
            type="button"
            className="brain-btn"
            onClick={() => actions.onUseChat?.(chat.id)}
            title="Like typing @ and picking this chat: its memory goes with your next message"
          >
            <AtSign size={13} aria-hidden="true" />
            Use in next message
          </button>
        )}
      </div>

      {sorted.length > 0 && (
        <ul className="arc-tags brain-panel-tags" aria-label="Concepts in this chat">
          {shown.map((n) => {
            const others = n.chatIds.length - 1
            return (
              <li
                key={n.key}
                className={`arc-tag${others > 0 ? ' is-shared' : ''}`}
                title={others > 0 ? `Also in ${others} other conversation${others === 1 ? '' : 's'}` : 'Only this conversation mentions it'}
              >
                {others > 0 && <span className="arc-tag-dot" aria-hidden="true" />}
                {/* A shared concept is on the map, so its name takes you there.
                    A lone one is never drawn, so it is just a name. */}
                {others > 0 ? (
                  <button
                    type="button"
                    className="arc-tag-name brain-tag-go"
                    onClick={() => actions.onSelect({ kind: 'concept', key: n.key })}
                  >
                    {n.label}
                    <span className="sr-only">, also in {others} other conversation{others === 1 ? '' : 's'}. Show on map</span>
                  </button>
                ) : (
                  <span className="arc-tag-name">{n.label}</span>
                )}
                <button
                  type="button"
                  className="arc-tag-x"
                  aria-label={`Forget “${n.label}” in this chat`}
                  title={`Forget “${n.label}” in this chat`}
                  onClick={() => actions.onForget(chat.id, n.key)}
                >
                  <X size={10} strokeWidth={2.5} aria-hidden="true" />
                </button>
              </li>
            )
          })}
        </ul>
      )}
      {sorted.length > CHIPS_SHOWN && (
        <button type="button" className="brain-more" onClick={() => setAll((v) => !v)} aria-expanded={all}>
          {all ? 'Show fewer' : `Show all ${sorted.length}`}
        </button>
      )}

    </section>
  )
}

export function ConceptDetails({
  concept,
  chats,
  openId,
  actions,
}: {
  concept: GraphNode
  /** The chats holding it, in the graph's order. */
  chats: GraphChat[]
  openId: string | null
  actions: DetailActions
}) {
  const n = chats.length

  return (
    <section aria-labelledby="brain-panel-title">
      <CloseButton onClose={actions.onClose} />
      <h3 id="brain-panel-title" className="brain-panel-title" tabIndex={-1}>
        {concept.label}
      </h3>
      <p className="brain-panel-meta">
        {n > 1 ? (
          <>
            Shared by <span className="brain-panel-hi tnum">{n} conversations</span>
          </>
        ) : (
          'Only one conversation mentions it'
        )}
      </p>
      <ul className="brain-panel-chats">
        {chats.map((chat) => {
          const title = chat.titleTruncated ? `${chat.title}…` : chat.title
          return (
            <li key={chat.id}>
              <button
                type="button"
                className="brain-chat-go"
                onClick={() => actions.onSelect({ kind: 'chat', id: chat.id })}
                title="Show this chat on the map"
              >
                <span className="t">{title}</span>
                {chat.id === openId && <span className="brain-panel-open">open</span>}
              </button>
              <button
                type="button"
                className="brain-icon-btn"
                onClick={() => actions.onOpenChat(chat.id)}
                aria-label={`Open ${chat.title}`}
                title="Open chat"
              >
                <ArrowUpRight size={14} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="brain-icon-btn is-danger"
                onClick={() => actions.onForget(chat.id, concept.key)}
                aria-label={`Forget “${concept.label}” in ${chat.title}`}
                title={`Forget “${concept.label}” in this chat`}
              >
                <X size={13} strokeWidth={2.5} aria-hidden="true" />
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
