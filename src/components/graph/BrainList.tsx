'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import type { GraphNode, ViewGraph } from '@/types/graph'
import { nodeIdOf, type Selection } from './sigma/brainGraph'

/**
 * The map, as a list: every conversation, and under each one the concepts it
 * shares with other conversations.
 *
 * The map is one canvas, and a canvas is a picture: a screen reader hears
 * nothing in it and Tab cannot reach a card. This is the same content as real
 * buttons. Choosing a chat or concept here selects it on the map, moves the
 * camera to it and opens its panel, so the list is also the quickest way to
 * find one card among hundreds.
 *
 * Only SHARED concepts are listed under a chat. They are the connections the
 * map is about; the rest are in each chat's panel.
 */

/** Shared concepts listed under one chat before "and N more". */
const PER_CHAT = 8

export function BrainList({
  graph,
  openId,
  openLabel,
  selected,
  onPick,
}: {
  /** The full graph: the list does not depend on what the map is hiding. */
  graph: ViewGraph
  openId: string | null
  openLabel: string
  selected: Selection | null
  onPick: (s: Selection, from: HTMLElement) => void
}) {
  const [query, setQuery] = useState('')
  const listRef = useRef<HTMLUListElement>(null)

  const sharedByChat = useMemo(() => {
    const map = new Map<string, GraphNode[]>()
    for (const node of graph.nodes) {
      if (node.chatIds.length < 2) continue
      for (const id of node.chatIds) {
        const list = map.get(id)
        if (list) list.push(node)
        else map.set(id, [node])
      }
    }
    for (const list of map.values()) {
      list.sort((a, b) => b.chatIds.length - a.chatIds.length || a.label.localeCompare(b.label))
    }
    return map
  }, [graph])

  const q = query.trim().toLowerCase()
  const rows = graph.chats
    .map((chat) => {
      const shared = sharedByChat.get(chat.id) ?? []
      if (!q) return { chat, shared, matchedChat: true }
      const matchedChat = chat.title.toLowerCase().includes(q)
      const hits = shared.filter((n) => n.label.toLowerCase().includes(q))
      return { chat, shared: matchedChat ? shared : hits, matchedChat, hit: matchedChat || hits.length > 0 }
    })
    .filter((r) => !q || r.hit)

  // A pick on the map scrolls its row into view here, so the two stay in step.
  const selectedId = selected ? nodeIdOf(selected) : null
  useEffect(() => {
    if (!selectedId) return
    const el = listRef.current?.querySelector<HTMLElement>(`[data-node="${CSS.escape(selectedId)}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [selectedId])

  return (
    <nav className="brain-list" aria-label="Conversations and shared concepts">
      <div className="brain-list-head">
        <h2 className="brain-list-h">
          Conversations <span className="tnum">{graph.chats.length}</span>
        </h2>
        <label className="brain-find">
          <Search size={13} aria-hidden="true" />
          <span className="sr-only">Find a chat or shared concept</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a chat or concept"
          />
        </label>
      </div>

      {rows.length === 0 ? (
        <p className="brain-list-empty">Nothing matches “{query.trim()}”.</p>
      ) : (
        <ul className="brain-list-items" ref={listRef}>
          {rows.map(({ chat, shared }) => {
            const id = nodeIdOf({ kind: 'chat', id: chat.id })
            const all = sharedByChat.get(chat.id)?.length ?? 0
            const shown = shared.slice(0, PER_CHAT)
            const title = chat.titleTruncated ? `${chat.title}…` : chat.title
            return (
              <li key={chat.id} className="brain-li">
                <button
                  type="button"
                  className="brain-li-chat"
                  data-node={id}
                  aria-current={selectedId === id ? 'true' : undefined}
                  onClick={(e) => onPick({ kind: 'chat', id: chat.id }, e.currentTarget)}
                >
                  <span className="t">{title}</span>
                  <span className="m tnum">
                    {chat.messageCount} message{chat.messageCount === 1 ? '' : 's'}
                    {all > 0 ? ` · ${all} shared` : ''}
                    {chat.id === openId && <span className="brain-panel-open"> · {openLabel}</span>}
                  </span>
                </button>
                {shown.length > 0 && (
                  <ul className="brain-li-tags" aria-label={`Shared concepts in ${chat.title}`}>
                    {shown.map((n) => {
                      const nid = nodeIdOf({ kind: 'concept', key: n.key })
                      return (
                        <li key={n.key}>
                          <button
                            type="button"
                            className="brain-li-tag"
                            data-node={nid}
                            aria-current={selectedId === nid ? 'true' : undefined}
                            onClick={(e) => onPick({ kind: 'concept', key: n.key }, e.currentTarget)}
                          >
                            {n.label}
                            <span className="n tnum" aria-hidden="true">
                              {n.chatIds.length}
                            </span>
                            <span className="sr-only">, in {n.chatIds.length} chats</span>
                          </button>
                        </li>
                      )
                    })}
                    {shared.length > PER_CHAT && (
                      <li className="brain-li-more">and {shared.length - PER_CHAT} more</li>
                    )}
                  </ul>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </nav>
  )
}
