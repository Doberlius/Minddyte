'use client'

import { useState } from 'react'
import { ArrowUpRight } from 'lucide-react'
import { RECORD_SEPARATOR, COMPACTION_CAP } from '@/lib/compaction'
import { splitInline } from '@/lib/inline-markdown'
import type { ViewGraph, GraphChat } from '@/types/graph'

/**
 * The Memory Archives tab.
 *
 * Every conversation, and the memory it would hand the assistant if it were
 * tagged into another one. This is the part of Minddyte hardest to believe
 * from a description — that the memory is the user's own sentences, kept word
 * for word and never paraphrased — so it is shown rather than claimed.
 *
 * Three things this page learned the hard way, from real conversations rather
 * than a written seed:
 *
 * 1. A model answers in markdown, so the memory read `**parallelize** the
 *    writing` and `### Why Postgres wins`. Right bytes, and it looked like a
 *    fault in the one panel that has to be believed. `splitInline` drops the
 *    syntax for display and keeps every word.
 * 2. Memories differ enormously in length — 0 characters beside 499 — so an
 *    unclamped list tore the grid into ragged columns of dead space. Four
 *    sentences show; the rest is one press away.
 * 3. A card was a dead end. Reading a memory and wanting the conversation it
 *    came from is the obvious next move, and there was nowhere to go.
 */

/** One stored sentence, with its markdown rendered rather than printed. */
function Sentence({ text }: { text: string }) {
  return (
    <li>
      {splitInline(text).map((part, i) =>
        part.bold ? (
          <strong key={i}>{part.text}</strong>
        ) : part.italic ? (
          <em key={i}>{part.text}</em>
        ) : part.code ? (
          <code key={i}>{part.text}</code>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </li>
  )
}

/** How many sentences a card shows before it asks. */
const SHOWN = 4

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
  const [all, setAll] = useState(false)
  const sentences = chat.compaction.split(RECORD_SEPARATOR).filter(Boolean)
  const shown = all ? sentences : sentences.slice(0, SHOWN)
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

      <div className="arc-meter">
        <span>Memory</span>
        <span className="tnum">
          {chat.compaction.length}
          <span aria-hidden="true">/{COMPACTION_CAP}</span>
          <span className="sr-only"> of {COMPACTION_CAP} characters used</span>
        </span>
      </div>

      {sentences.length === 0 ? (
        // A heading and a 0 with nothing under it reads as a broken card. It
        // is not broken — there is simply nothing said here yet.
        <p className="arc-none">
          Nothing yet. A memory appears with this conversation&rsquo;s first message.
        </p>
      ) : (
        <>
          <ol className="arc-memory">
            {shown.map((s, i) => (
              <Sentence key={i} text={s} />
            ))}
          </ol>
          {sentences.length > SHOWN && (
            <button className="arc-more" onClick={() => setAll(!all)}>
              {all ? 'Show less' : `Show all ${sentences.length} sentences`}
            </button>
          )}
        </>
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
            Nothing is archived yet. Every conversation keeps a short memory of
            its own sentences, and it appears here as soon as you send one.
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
            What the assistant is handed when a conversation is tagged into another —
            the original sentences, word for word, newest first, capped at{' '}
            {COMPACTION_CAP} characters.
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
