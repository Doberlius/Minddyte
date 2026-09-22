'use client'

import { useEffect, useState } from 'react'
import { HelpCircle, RotateCcw } from 'lucide-react'
import { Sidebar, type ChatSummary, type Tab } from '@/components/layout/Sidebar'
import { DemoGuide } from '@/components/demo/DemoGuide'
import { DemoTour } from '@/components/demo/DemoTour'
import { DemoChat } from '@/components/demo/DemoChat'
import { BrainView } from '@/components/graph/BrainView'
import { ArchiveView } from '@/components/archive/ArchiveView'
import { toViewGraph } from '@/demo/view'
import { sendMessage, forget, chatById, keysHeldOutside, type DemoGraph } from '@/demo/graph'
import { seededGraph } from '@/demo/seed'
import { writtenReply, looksLikeAQuestion } from '@/demo/reply'
import { demoRetrieve, type Reached } from '@/demo/retrieve'
import { extractConcepts } from '@/lib/extract'
import { canonicalKey } from '@/lib/text'

/**
 * Minddyte's live demo.
 *
 * It wears the application's own shell — the same `Sidebar`, the same three
 * views, the same composer — because a demo that invents its own interface is
 * advertising something that does not exist. What differs is underneath:
 * these panels run against an in-memory graph rather than PGlite, and the
 * assistant's replies are written rather than generated.
 *
 * Everything the graph does is still the application's own code. `lib/extract`
 * finds the concepts, `lib/text` decides their identity, `lib/compaction`
 * builds the memory. Since the graph is authored deterministically, removing
 * the model removes nothing the graph depended on — which is the claim the
 * demo exists to demonstrate, and why it can be shown at all.
 *
 * The visitor now keeps as many conversations as they like rather than one.
 * That is not decoration to fill a sidebar: with a single chat, the only links
 * a visitor could ever create ran from their conversation out to the seeded
 * ones. Two of their own can share a concept with EACH OTHER, which is the
 * product's actual claim and was previously impossible to show.
 *
 * One thing is added that the application does not have: the `DemoGuide` bar.
 * A visitor arrives with no account, no history and no idea what "Neural
 * Brain" means, and navigation alone never told them what to do next.
 */

// The views are the app's, so their type is too. Re-exported because the
// demo's own components have always imported it from here.
export type { Tab }

/** What the last message produced, shown inline in the transcript. */
export type Extraction = {
  auto: string[]
  connected: string[]
  suggested: string[]
  /** Whether the visitor asked something, which this demo cannot answer. */
  asked: boolean
  /** The conversations whose memory this message would have been sent with. */
  reached: Reached[]
  mode: 'focus' | 'explore'
}

/**
 * Marks that the tour has been read. Storage is per browser and holds one
 * flag, so a visitor is introduced once rather than on every visit.
 */
const TOUR_SEEN = 'minddyte.demo.tourSeen'

/** Keyed by chat, then by the index of the user message it belongs to. */
type Extractions = Record<string, Record<number, Extraction>>

export default function DemoPage() {
  const [tab, setTab] = useState<Tab>('chat')
  // Lazy, so the seed is folded through the real ingest path exactly once.
  const [graph, setGraph] = useState<DemoGraph>(() => seededGraph())
  /**
   * The chats the visitor started, newest first.
   *
   * Not "the chats they have sent into": a seeded conversation they add a line
   * to is still one of the five that were already here, and the canvas marks
   * these to answer "which of these did I make?".
   */
  const [mine, setMine] = useState<string[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [extractions, setExtractions] = useState<Extractions>({})
  const [newKeys, setNewKeys] = useState<string[]>([])
  // The app's two retrieval modes, and the chats brought in by hand. Both
  // decide what the assistant would receive, which is what `demoRetrieve`
  // works out and the transcript then shows.
  const [mode, setMode] = useState<'focus' | 'explore'>('explore')
  const [tagged, setTagged] = useState<string[]>([])
  /**
   * Whether the opening tour is up.
   *
   * `null` until the browser has been asked, so the overlay never flashes on
   * a return visit and never renders during server rendering, where
   * localStorage does not exist. Read in an effect for the same reason.
   */
  const [tourOpen, setTourOpen] = useState<boolean | null>(null)

  useEffect(() => {
    try {
      setTourOpen(localStorage.getItem(TOUR_SEEN) === null)
    } catch {
      // Private browsing and blocked storage both throw. An introduction is
      // not worth a blank page, so show it and simply do not remember.
      setTourOpen(true)
    }
  }, [])

  function closeTour() {
    setTourOpen(false)
    try {
      localStorage.setItem(TOUR_SEEN, '1')
    } catch {}
  }

  const active = activeId ? chatById(graph, activeId) : undefined
  const view = toViewGraph(graph)
  const hasSent = mine.length > 0

  /** Newest first, so a conversation the visitor just started sits at the top. */
  const summaries: ChatSummary[] = [...graph.chats]
    .reverse()
    .map((chat) => ({
      id: chat.id,
      title: chat.title,
      nodeCount: graph.nodes.filter((n) => n.chatIds.includes(chat.id)).length,
    }))

  function handleSend(text: string) {
    // No chat open means the composer is starting one, exactly as the app
    // creates a session lazily on send rather than on New chat.
    const chatId = activeId ?? `yours-${mine.length + 1}`
    const isNew = !chatById(graph, chatId)

    // Captured BEFORE ingest, and excluding this conversation: afterwards
    // every key is present, and a key this chat already held is not a link to
    // anywhere. See `keysHeldOutside`.
    const elsewhere = keysHeldOutside(graph, chatId)

    const { auto, suggested } = extractConcepts(text)
    const connected = auto.filter((label) => elsewhere.has(canonicalKey(label)))

    // Worked out BEFORE ingest, like the app: retrieval runs against the graph
    // as it stood when you pressed Send, not the one your own message just
    // changed. Otherwise a conversation would always reach itself.
    const reached = demoRetrieve(graph, { chatId, mode, taggedChatIds: tagged, draftText: text })

    const assistantText = writtenReply({ auto, connected, suggested })

    // `rememberAssistant: false` — the reply is a report about the extractor,
    // not something anyone said, and the Archive is for your sentences.
    const next = sendMessage(graph, {
      chatId,
      userText: text,
      assistantText,
      rememberAssistant: false,
    })

    // Keyed by the index of the user message it belongs to, so the transcript
    // can show what each turn contributed rather than only the latest.
    const turnIndex = (chatById(next, chatId)?.messages.length ?? 2) - 2
    setExtractions({
      ...extractions,
      [chatId]: { ...(extractions[chatId] ?? {}), [turnIndex]: { auto, connected, suggested, asked: looksLikeAQuestion(text), reached, mode } },
    })
    setGraph(next)
    setActiveId(chatId)
    if (isNew) setMine([chatId, ...mine])
    setNewKeys(auto.map(canonicalKey).filter(Boolean))
    // Tags apply to the message you attached them to, exactly as in the app.
    setTagged([])
  }

  /**
   * Delete a concept from a conversation, memory and all.
   *
   * Left entirely to the graph: `forget` unlinks the Node, rebuilds that
   * chat's Compaction without the sentences that named it, and records the
   * label so saying it again never brings it back. Nothing here needs to
   * know any of that, which is the point of it living there.
   */
  function handleForget(chatId: string, label: string) {
    setGraph(forget(graph, { chatId, label }))
    // The canvas pulse marks what just arrived; a deletion is the opposite
    // event and would otherwise leave a stale halo on a concept that went.
    setNewKeys([])
  }

  function reset() {
    setGraph(seededGraph())
    setMine([])
    setActiveId(null)
    setExtractions({})
    setNewKeys([])
    setTagged([])
    setMode('explore')
    // Back to the start of the walkthrough, not to an archive that no longer
    // holds the conversation the visitor came to this tab to read.
    setTab('chat')
  }

  return (
    <div className="app-shell">
      {tourOpen && (
        <DemoTour
          onClose={closeTour}
          onStart={(text) => {
            closeTour()
            setTab('chat')
            handleSend(text)
          }}
        />
      )}
      <Sidebar
        activeTab={tab}
        onTabChange={setTab}
        chats={summaries}
        activeChatId={activeId}
        onSelectChat={(id) => {
          setActiveId(id)
          setTagged([])
          setTab('chat')
        }}
        onNewChat={() => {
          // Nothing is added to the graph here. The chat appears when you SEND,
          // which is the app's rule too — opening one and walking away should
          // not leave an empty row behind.
          setActiveId(null)
          setTagged([])
          setTab('chat')
        }}
        footer={
          <>
            <span className="demo-badge">Demo</span>
            <button
              onClick={() => setTourOpen(true)}
              className="btn-ghost"
              aria-label="How this works"
              title="How this works"
              style={{ marginLeft: 'auto', padding: 6, color: 'var(--ink2)' }}
            >
              <HelpCircle size={14} />
            </button>
            <button
              onClick={reset}
              className="btn-ghost"
              aria-label="Reset the demo"
              style={{ gap: 6, fontSize: 12, padding: '6px 10px', color: 'var(--ink2)', fontFamily: 'inherit' }}
            >
              <RotateCcw size={12} />
              <span className="demo-reset-label">Reset</span>
            </button>
          </>
        }
      />

      <main style={{ flex: 1, minWidth: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <DemoGuide tab={tab} hasSent={hasSent} onGoto={setTab} onReset={reset} />

        {tab === 'chat' && (
          <DemoChat
            chat={active}
            graph={graph}
            extractions={activeId ? (extractions[activeId] ?? {}) : {}}
            isMine={activeId ? mine.includes(activeId) : false}
            chats={summaries.filter((c) => c.id !== activeId)}
            mode={mode}
            onModeChange={setMode}
            tagged={tagged}
            onTaggedChange={setTagged}
            onSend={handleSend}
            onSeeGraph={() => setTab('brain')}
          />
        )}
        {/* The application's own Brain and Archive, handed the demo's graph
            through an adapter rather than reimplemented against it. */}
        {tab === 'brain' && (
          <BrainView
            graph={view}
            highlight={mine}
            highlightLabel="one you started"
            focusId={activeId}
            newKeys={newKeys}
          />
        )}
        {tab === 'archive' && (
          <ArchiveView
            graph={view}
            highlight={mine}
            highlightLabel="your conversation"
            onOpen={(id) => {
              setActiveId(id)
              setTagged([])
              setTab('chat')
            }}
            onForget={handleForget}
          />
        )}
      </main>
    </div>
  )
}
