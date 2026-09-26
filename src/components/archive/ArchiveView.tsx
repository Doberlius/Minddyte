'use client'

import { useState } from 'react'
import { ArrowUpRight, X } from 'lucide-react'
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
 *
 * Each concept tag can also carry a small × (ticket 10, Q3). It opens the
 * forget confirmation for that concept in that card's chat. It only appears
 * when the page passes `onForget`, so a view that cannot forget (or does not
 * want to) gets plain tags.
 *
 * Concepts are quiet on purpose: they are what a chat is ABOUT, not what the
 * card is for. Neutral tags, the first eight, "Show all" for the rest.
 */

/**
 * How many concepts a card shows before "Show all". A chat built from a
 * pasted essay holds fifty; listing every one made that card the whole page,
 * and the rest of the Archive an afterthought beneath it.
 */
const CONCEPTS_SHOWN = 8

function Card({
  chat,
  graph,
  isYours,
  highlightLabel,
  onOpen,
  onForget,
}: {
  chat: GraphChat
  graph: ViewGraph
  isYours: boolean
  highlightLabel: string
  onOpen?: (id: string) => void
  onForget?: (chatId: string, key: string) => void
}) {
  const [showAll, setShowAll] = useState(false)
  const concepts = graph.nodes.filter((n) => n.chatIds.includes(chat.id))
  const shown = showAll ? concepts : concepts.slice(0, CONCEPTS_SHOWN)
  // deriveTitle caps at 60 characters and can land mid-clause; without the
  // ellipsis the card reads as a rendering bug rather than a derived title.
  const truncated = chat.titleTruncated

  const title = truncated ? `${chat.title}…` : chat.title
  const tagsId = `arc-tags-${chat.id}`

  return (
    <article
      className="arc-card"
      // How the Archive finds this card again to put focus on it after one of
      // its chips is forgotten (the × that had focus is gone by then).
      data-chat-id={chat.id}
      // That focus goes to the title button when there is one. Without it,
      // the card itself takes focus: -1 lets code focus it without adding a
      // Tab stop.
      tabIndex={onForget && !onOpen ? -1 : undefined}
    >
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
        <div className="arc-concepts">
          <ul className="arc-tags" id={tagsId} aria-label="Concepts in this chat">
            {shown.map((n) => {
              const others = n.chatIds.length - 1
              const sharedNote = `Also in ${others} other conversation${others === 1 ? '' : 's'}`
              return (
                <li
                  key={n.key}
                  className={`arc-tag${others > 0 ? ' is-shared' : ''}`}
                  title={others > 0 ? sharedNote : 'Only this conversation mentions it'}
                >
                  {/* Shared is a quiet dot, not a filled pill: in a chat where
                      most concepts are shared, filling them turned the whole
                      card into a violet wall. The header counts them. */}
                  {others > 0 && <span className="arc-tag-dot" aria-hidden="true" />}
                  <span className="arc-tag-name">{n.label}</span>
                  {others > 0 && <span className="sr-only">, {sharedNote.toLowerCase()}</span>}
                  {/* A real button, so Tab reaches it and Enter/Space press it.
                      Its space is always kept, so nothing moves when it shows. */}
                  {onForget && (
                    <button
                      type="button"
                      className="arc-tag-x"
                      aria-label={`Forget “${n.label}” in this chat`}
                      title={`Forget “${n.label}” in this chat`}
                      onClick={() => onForget(chat.id, n.key)}
                    >
                      <X size={10} strokeWidth={2.5} aria-hidden="true" />
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
          {concepts.length > CONCEPTS_SHOWN && (
            <button
              type="button"
              className="arc-more"
              aria-expanded={showAll}
              aria-controls={tagsId}
              onClick={() => setShowAll((v) => !v)}
            >
              {showAll ? 'Show fewer' : `Show all ${concepts.length}`}
            </button>
          )}
        </div>
      )}

      {chat.passageCount === 0 ? (
        <p className="arc-none">Nothing saved yet.</p>
      ) : (
        <p className="arc-count tnum">
          {chat.messageCount} message{chat.messageCount === 1 ? '' : 's'} ·{' '}
          {chat.passageCount} sentence{chat.passageCount === 1 ? '' : 's'} saved
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
  onForget,
}: {
  graph: ViewGraph
  /** Conversations to mark apart: the demo's own, the app's open one. */
  highlight: string[]
  highlightLabel: string
  /** Open a conversation. Without it a card is a place you can only look at. */
  onOpen?: (id: string) => void
  /**
   * Forget one concept in one chat. When given, each chip gets its × button;
   * without it the chips are look-only, as they always were.
   */
  onForget?: (chatId: string, key: string) => void
}) {
  const shared = graph.nodes.filter((n) => n.chatIds.length > 1).length

  if (graph.chats.length === 0) {
    return (
      <div className="arc-wrap">
        <div className="arc-inner">
          <h1 className="arc-h1">Memory Archives</h1>
          <p className="arc-none" style={{ maxWidth: 460 }}>
            No chats yet. Send a message and it shows up here.
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
            All your chats and the topics in each. When you ask something, the
            sentences that fit your question best are picked from these.
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
              onForget={onForget}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
