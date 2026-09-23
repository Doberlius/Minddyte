'use client'

import { ArrowUpRight } from 'lucide-react'
import type { ViewGraph, GraphChat } from '@/types/graph'

/**
 * The Memory Archives tab.
 *
 * Every conversation, shown by what has been indexed from it rather than by
 * a fixed memory. Under read-time pointers there is no longer one digest a
 * chat "has" — the assistant picks its passages fresh at question time, from
 * whichever conversation is being asked about, so there is nothing fixed
 * here to preview. What this page can show, and does, is what got indexed:
 * how many passages (sentences, code blocks, tables) and how many messages,
 * per conversation, alongside the concepts it shares with others.
 *
 * A card was a dead end. Reading a conversation's summary and wanting the
 * conversation it came from is the obvious next move, and there was nowhere
 * to go — so a card's title opens it.
 */

function Card({
  chat,
  graph,
  isYours,
  highlightLabel,
  onOpen,
}: {
  chat: GraphChat
  graph: ViewGraph
  isYours: boolean
  highlightLabel: string
  onOpen?: (id: string) => void
}) {
  const concepts = graph.nodes.filter((n) => n.chatIds.includes(chat.id))
  // deriveTitle caps at 60 characters and can land mid-clause; without the
  // ellipsis the card reads as a rendering bug rather than a derived title.
  const truncated = chat.titleTruncated

  const title = truncated ? `${chat.title}…` : chat.title

  return (
    <article className="arc-card">
      <header className="arc-head">
        {onOpen ? (
          <button className="arc-title" onClick={() => onOpen(chat.id)}>
            <span>{title}</span>
            <ArrowUpRight size={14} aria-hidden="true" />
          </button>
        ) : (
          <h2 className="arc-title is-static">{title}</h2>
        )}
        {isYours && <span className="arc-mine">{highlightLabel}</span>}
      </header>

      {concepts.length > 0 && (
        <div className="arc-chips">
          {concepts.map((n) => (
            <span
              key={n.key}
              className={`demo-chip${n.chatIds.length > 1 ? ' is-shared' : ''}`}
              title={
                n.chatIds.length > 1
                  ? `Also in ${n.chatIds.length - 1} other conversation${n.chatIds.length > 2 ? 's' : ''}`
                  : 'Only this conversation mentions it'
              }
            >
              {n.label}
              {n.chatIds.length > 1 && <b>{n.chatIds.length}</b>}
            </span>
          ))}
        </div>
      )}

      {chat.passageCount === 0 ? (
        <p className="arc-none">Nothing yet. This conversation is indexed from its first message.</p>
      ) : (
        <p className="arc-count tnum">
          {chat.passageCount} passage{chat.passageCount === 1 ? '' : 's'} indexed · {chat.messageCount} message
          {chat.messageCount === 1 ? '' : 's'}
        </p>
      )}
    </article>
  )
}

export function ArchiveView({
  graph,
  highlight,
  highlightLabel,
  onOpen,
}: {
  graph: ViewGraph
  /** Conversations to mark apart: the demo's own, the app's open one. */
  highlight: string[]
  highlightLabel: string
  /** Open a conversation. Without it a card is a place you can only look at. */
  onOpen?: (id: string) => void
}) {
  const shared = graph.nodes.filter((n) => n.chatIds.length > 1).length

  if (graph.chats.length === 0) {
    return (
      <div className="arc-wrap">
        <div className="arc-inner">
          <h1 className="arc-h1">Memory Archives</h1>
          <p className="arc-none" style={{ maxWidth: 460 }}>
            Nothing is archived yet. Every conversation is indexed from its
            first message, word for word, and it appears here as soon as you
            send one.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="arc-wrap">
      <div className="arc-inner">
        <header className="arc-top">
          <h1 className="arc-h1">Memory Archives</h1>
          <p className="arc-lede">
            What the assistant can draw on when a conversation is tagged into
            another — the original sentences, word for word, chosen fresh for
            whatever is asked rather than kept as one fixed summary.
          </p>
          <p className="arc-count tnum">
            {graph.chats.length} conversation{graph.chats.length === 1 ? '' : 's'} ·{' '}
            {graph.nodes.length} concept{graph.nodes.length === 1 ? '' : 's'} ·{' '}
            <span className="arc-count-hi">{shared} shared</span>
          </p>
        </header>

        <div className="arc-grid">
          {graph.chats.map((chat) => (
            <Card
              key={chat.id}
              chat={chat}
              graph={graph}
              isYours={highlight.includes(chat.id)}
              highlightLabel={highlightLabel}
              onOpen={onOpen}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
