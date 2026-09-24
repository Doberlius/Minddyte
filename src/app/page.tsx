'use client'

import { useCallback, useEffect, useState } from 'react'
import { HelpCircle } from 'lucide-react'
import { Sidebar, type ChatSummary, type Tab } from '@/components/layout/Sidebar'
import { AppTour } from '@/components/layout/AppTour'
import { CoreEditor, type SavedCore } from '@/components/core/CoreEditor'
import { NeuralChat } from '@/components/chat'
import { NeuralBrain } from '@/components/brain'
import { MemoryArchives } from '@/components/archive'
import { Toast } from '@/components/ui/Toast'
import { useToast } from '@/components/ui/useToast'

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

  /**
   * "About you": asked for once on load. `null` until the answer arrives —
   * the editor pre-fills from this, and an editor opened on a note that
   * never loaded would offer an empty box whose Save wipes the real one.
   */
  const [core, setCore] = useState<SavedCore | null>(null)
  const [coreOpen, setCoreOpen] = useState(false)
  const [coreOpening, setCoreOpening] = useState(false)
  const { message: toastMessage, showToast } = useToast()

  const loadCore = useCallback(async (): Promise<SavedCore | null> => {
    try {
      const res = await fetch('/api/core')
      if (!res.ok) return null
      const data = await res.json()
      const loaded = {
        text: typeof data.text === 'string' ? data.text : '',
        updatedAt: data.updatedAt ? new Date(data.updatedAt) : null,
      }
      setCore(loaded)
      return loaded
    } catch {
      return null
    }
  }, [])

  useEffect(() => {
    void loadCore()
  }, [loadCore])

  /**
   * Whole-branch review, finding 2: reusing the Core fetched at page load let
   * tab A overwrite a newer save from tab B, because the editor opened with
   * whatever text this tab happened to have in memory. So every open re-reads
   * `GET /api/core` — the editor only ever shows what the server has right
   * now. Finding 3: a failed re-fetch used to open nothing and say nothing;
   * now it says so with the toast, in place of the silent no-op.
   */
  async function openCore() {
    if (coreOpening) return
    setCoreOpening(true)
    const fresh = await loadCore()
    setCoreOpening(false)
    if (fresh) setCoreOpen(true)
    else showToast("Couldn't open About you. Try again.")
  }

  const activeChat = chats.find((c) => c.id === activeId) ?? null

  return (
    // The class, not inline styles: at narrow widths the column becomes a strip
    // along the top, and a media query cannot reach a style attribute.
    <div className="app-shell">
      {tourOpen && <AppTour onClose={closeTour} />}
      <Toast message={toastMessage} />

      {coreOpen && core && (
        <CoreEditor
          initialText={core.text}
          onSaved={(saved) => {
            setCore(saved)
            setCoreOpen(false)
          }}
          onClose={() => setCoreOpen(false)}
        />
      )}

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
        coreUpdatedAt={core?.updatedAt ?? null}
        coreLoaded={core !== null}
        onOpenCore={() => void openCore()}
        footer={
          // A labelled row, not an icon: the guide opens by itself only on the
          // first visit, so this is the one way back and it has to be found
          // without hunting. Same shape as the view rows above it on purpose.
          <button
            onClick={() => setTourOpen(true)}
            className="side-row side-help"
            title="Show the intro slides again"
          >
            <span className="side-ic">
              <HelpCircle size={15} />
            </span>
            Help
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
