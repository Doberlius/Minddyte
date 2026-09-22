'use client'

import { useMemo, useState } from 'react'
import { Brain, MessageSquare, BookOpen, MoreHorizontal, Plus, Search, X } from 'lucide-react'
import { ChatMenu, type MenuAt } from './ChatMenu'

/**
 * The left column.
 *
 * Replaces the horizontal tab bar outright — there is no tab bar anywhere in
 * the app now. Two reasons, both from the sidebar study:
 *
 * 1. A tab bar cannot hold a chat list, so the visible chat was whichever
 *    uuid sat in an env var. Switching chats meant editing `.env` and
 *    restarting the server.
 * 2. Stacked rows take a fourth view for free. A tab bar starts competing for
 *    horizontal room with the thing it sits above.
 *
 * The views sit ABOVE the action deliberately: they answer "where am I", and
 * New chat then acts inside the view you chose.
 */

export type Tab = 'chat' | 'brain' | 'archive'

export type ChatSummary = {
  id: string
  title: string
  nodeCount: number
}

const VIEWS: { key: Tab; label: string; icon: React.ReactNode }[] = [
  { key: 'chat', label: 'Chat', icon: <MessageSquare size={15} /> },
  { key: 'brain', label: 'Brain', icon: <Brain size={15} /> },
  { key: 'archive', label: 'Archive', icon: <BookOpen size={15} /> },
]

export function Sidebar({
  activeTab,
  onTabChange,
  chats,
  activeChatId,
  onSelectChat,
  onNewChat,
  onDeleteChat,
  onRenameChat,
  footer,
}: {
  activeTab: Tab
  onTabChange: (tab: Tab) => void
  chats: ChatSummary[]
  /** Null while a new chat is being composed; it has no row to highlight yet. */
  activeChatId: string | null
  onSelectChat: (id: string) => void
  onNewChat: () => void
  /**
   * Delete a chat. Omitted by a caller that cannot delete — the demo runs on
   * an in-memory graph and has no endpoint behind this — and the row then
   * offers no menu at all rather than one that does nothing.
   */
  onDeleteChat?: (id: string) => void
  /** Rename a chat. Optional for the same reason as delete. */
  onRenameChat?: (id: string, title: string) => void
  /**
   * Pinned under the list. The demo puts its standing "no database, no model"
   * mark and its Reset here; the app has nothing to put there yet.
   */
  footer?: React.ReactNode
}) {
  const [query, setQuery] = useState('')
  const [menu, setMenu] = useState<MenuAt | null>(null)

  /**
   * Titles only, on the client.
   *
   * That is a filter over a list already in hand — it works today, offline,
   * with no query and no index. Searching message CONTENT is a different
   * feature with a different cost, and pretending otherwise by shipping a box
   * that searches less than it appears to is worse than a box that says
   * "Search titles".
   */
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return chats
    return chats.filter((c) => c.title.toLowerCase().includes(q))
  }, [chats, query])

  return (
    // The view is on the element so CSS can react to it: on a phone the
    // recents are Chat's navigation, and on Brain or Archive they are 140px of
    // the screen spent on a list that leads away from what you are looking at.
    <div className="side" data-view={activeTab}>
      <div className="side-brand">
        <span className="side-mark" aria-hidden="true">
          <Brain size={15} />
        </span>
        Minddyte
      </div>

      <div className="side-pad">
        <nav className="side-nav" aria-label="Views">
          {VIEWS.map((view) => (
            <button
              key={view.key}
              className={`side-row${activeTab === view.key ? ' is-on' : ''}`}
              aria-current={activeTab === view.key ? 'page' : undefined}
              onClick={() => onTabChange(view.key)}
            >
              <span className="side-ic">{view.icon}</span>
              {view.label}
            </button>
          ))}
        </nav>

        <div className="side-rule" />

        <button className="side-new" onClick={onNewChat}>
          <Plus size={15} />
          New chat
        </button>

        <div className="side-rule" />

        <div className="side-search">
          <Search size={12} aria-hidden="true" />
          <label className="sr-only" htmlFor="chat-search">
            Search chat titles
          </label>
          <input
            id="chat-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search titles"
            autoComplete="off"
          />
          {query && (
            <button className="side-clear" onClick={() => setQuery('')} aria-label="Clear search">
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      <div className="side-group" id="recents-label">
        Recents
      </div>

      <div className="side-list" role="list" aria-labelledby="recents-label">
        {chats.length === 0 && (
          // Not "no results": there is nothing to have results in yet, and the
          // recovery is the thing the app wants you to do anyway.
          <p className="side-empty">
            No conversations yet. Your first message starts one.
          </p>
        )}

        {chats.length > 0 && filtered.length === 0 && (
          <p className="side-empty">
            No title matches “{query.trim()}”.
          </p>
        )}

        {filtered.map((chat) => (
          // A wrapper, because the row is a button and the ··· is another one:
          // a button inside a button is invalid, so they are siblings and the
          // menu sits above the row rather than inside it.
          <div key={chat.id} role="listitem" className="side-chat-row">
            <button
              className={`side-chat${chat.id === activeChatId ? ' is-on' : ''}`}
              aria-current={chat.id === activeChatId ? 'true' : undefined}
              onClick={() => onSelectChat(chat.id)}
              onContextMenu={
                onDeleteChat
                  ? (e) => {
                      e.preventDefault()
                      setMenu({ id: chat.id, title: chat.title, x: e.clientX, y: e.clientY })
                    }
                  : undefined
              }
            >
              <span className="t">{chat.title}</span>
              <span className="m tnum">
                {chat.nodeCount} concept{chat.nodeCount === 1 ? '' : 's'}
              </span>
            </button>

            {onDeleteChat && (
              <button
                className="side-chat-more"
                aria-label={`Actions for ${chat.title}`}
                aria-haspopup="menu"
                onClick={(e) => {
                  e.stopPropagation()
                  const r = e.currentTarget.getBoundingClientRect()
                  setMenu({ id: chat.id, title: chat.title, x: r.right - 8, y: r.bottom + 4 })
                }}
              >
                <MoreHorizontal size={14} />
              </button>
            )}
          </div>
        ))}
      </div>

      {/*
       * Unconditional, unlike `footer` below: `footer` is a prop a caller may
       * or may not pass, so it cannot be where every visitor learns that a
       * workspace is only a cookie. This has to render for every tab, every
       * time, or someone will assume their chats are backed up somewhere.
       */}
      <p className="side-note">
        Your chats live in this browser only — no account, nothing synced.
        Clearing your cookies starts you over.
      </p>

      {footer && <div className="side-foot">{footer}</div>}

      {menu && onDeleteChat && (
        <ChatMenu
          at={menu}
          onRename={onRenameChat}
          onDelete={onDeleteChat}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  )
}
