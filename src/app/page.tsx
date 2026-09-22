'use client'

import { useCallback, useEffect, useState } from 'react'
import { HelpCircle } from 'lucide-react'
import { Sidebar, type ChatSummary, type Tab } from '@/components/layout/Sidebar'
import { AppTour } from '@/components/layout/AppTour'
import { NeuralChat } from '@/components/chat'
import { NeuralBrain } from '@/components/brain'
import { MemoryArchives } from '@/components/archive'

/**
 * The app shell.
 *
 * Which chat is open now lives here rather than inside the chat panel. The
 * sidebar and the transcript both need that answer, and the panel is not the
 * right owner of something its sibling reads.
 */

// Disk, not RAM: ~5-10 MB per origin and this holds one uuid. React state is
// what lives in memory, and is exactly why a reload used to lose your chat.
const SESSION_KEY = 'minddyte.sessionId'
/**
 * Marks that the guide has been read. Its own key, separate from the demo's:
 * the two decks say different things and reading one is not reading the other.
 */
const TOUR_SEEN = 'minddyte.tourSeen'

export default function Page() {
  const [tab, setTab] = useState<Tab>('chat')
  const [chats, setChats] = useState<ChatSummary[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  // localStorage is not available during server rendering, so the remembered
  // chat is read in an effect rather than in the initial state.
  const [restored, setRestored] = useState(false)
  /**
   * `null` until the browser has been asked, so the overlay never flashes on a
   * return visit and never renders during server rendering, where localStorage
   * does not exist.
   */
  const [tourOpen, setTourOpen] = useState<boolean | null>(null)

  useEffect(() => {
    setActiveId(localStorage.getItem(SESSION_KEY))
    setRestored(true)
    try {
      setTourOpen(localStorage.getItem(TOUR_SEEN) === null)
    } catch {
      // Private browsing and blocked storage both throw. A guide is not worth
      // a blank page, so show it and simply do not remember.
      setTourOpen(true)
    }
  }, [])

  function closeTour() {
    setTourOpen(false)
    try {
      localStorage.setItem(TOUR_SEEN, '1')
    } catch {}
  }

  const refreshChats = useCallback(async () => {
    try {
      const res = await fetch('/api/sessions')
      // fetch does not reject on 4xx, and the error body parses as valid JSON —
      // without the ok check, setChats would receive an object and the sidebar
      // would throw on .filter().
      const data = res.ok ? await res.json() : []
      setChats(Array.isArray(data) ? data : [])
    } catch {
      // A failed list leaves the previous one standing. The chat you are in
      // still works; only the recents are stale.
    }
  }, [])

  useEffect(() => {
    void refreshChats()
  }, [refreshChats])

  /** Remembering the open chat is this component's job now, in one place. */
  const openChat = useCallback((id: string | null) => {
    setActiveId(id)
    if (id) localStorage.setItem(SESSION_KEY, id)
    else localStorage.removeItem(SESSION_KEY)
  }, [])

  /**
   * Delete a chat, from the sidebar's menu.
   *
   * The row goes first, before the request finishes: the list is a local copy
   * of the server's answer and a delete that leaves the row sitting there
   * until a round trip completes reads as a click that did nothing. If the
   * request then fails, `refreshChats` puts it back — the server's list is the
   * one that decides, and the recovery is a re-read rather than a guess.
   *
   * Closing it first when it is the open one matters more than it looks: the
   * transcript would otherwise fetch a chat that no longer exists, and the
   * panel's own recovery would fire for a chat the person deliberately removed.
   */
  const deleteChat = useCallback(
    async (id: string) => {
      setChats((prev) => prev.filter((c) => c.id !== id))
      if (id === activeId) openChat(null)

      try {
        const res = await fetch(`/api/sessions/${id}`, { method: 'DELETE' })
        // 404 means it had already gone, which is the state we wanted.
        if (!res.ok && res.status !== 404) await refreshChats()
      } catch {
        await refreshChats()
      }
    },
    [activeId, openChat, refreshChats],
  )

  /**
   * Rename a chat from the sidebar's menu.
   *
   * Optimistic for the same reason as the delete above: the list is a copy of
   * the server's answer, and a name that only changes after a round trip reads
   * as a press that did nothing. A failure re-reads rather than guesses.
   */
  const renameChat = useCallback(
    async (id: string, title: string) => {
      setChats((prev) => prev.map((c) => (c.id === id ? { ...c, title } : c)))

      try {
        const res = await fetch(`/api/sessions/${id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ title }),
        })
        if (!res.ok) await refreshChats()
      } catch {
        await refreshChats()
      }
    },
    [refreshChats],
  )

  const activeChat = chats.find((c) => c.id === activeId) ?? null

  return (
    // The class, not inline styles: at narrow widths the column becomes a strip
    // along the top, and a media query cannot reach a style attribute.
    <div className="app-shell">
      {tourOpen && <AppTour onClose={closeTour} />}

      <Sidebar
        activeTab={tab}
        onTabChange={setTab}
        chats={chats}
        activeChatId={activeId}
        onSelectChat={(id) => {
          openChat(id)
          setTab('chat')
        }}
        onDeleteChat={deleteChat}
        onRenameChat={renameChat}
        footer={
          <button
            onClick={() => setTourOpen(true)}
            className="btn-ghost"
            aria-label="How this works"
            title="How this works"
            style={{ padding: 6, color: 'var(--ink2)' }}
          >
            <HelpCircle size={14} />
          </button>
        }
        onNewChat={() => {
          // Nothing is written here. The row appears when you SEND: opening a
          // new chat and walking away leaves no `New Session` debris behind,
          // which the eager version would have needed a guard to prevent.
          openChat(null)
          setTab('chat')
        }}
      />

      <main style={{ flex: 1, minWidth: 0, overflow: 'hidden', display: 'flex' }}>
        {tab === 'chat' && (
          <NeuralChat
            chats={chats}
            activeChat={activeChat}
            // Until localStorage has been read, the panel cannot tell "no chat
            // yet" from "not looked yet", and would clear a transcript it is
            // about to be told to load.
            sessionId={restored ? activeId : undefined}
            onSessionChange={openChat}
            onChatsChanged={refreshChats}
          />
        )}
        {tab === 'brain' && <NeuralBrain activeChatId={activeId} />}
        {tab === 'archive' && (
          <MemoryArchives
            activeChatId={activeId}
            onOpenChat={(id) => {
              openChat(id)
              setTab('chat')
            }}
          />
        )}
      </main>
    </div>
  )
}
