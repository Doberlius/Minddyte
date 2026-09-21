'use client'

import { useState } from 'react'
import { Brain, RotateCcw } from 'lucide-react'
import { GraphCanvas } from '@/components/demo/GraphCanvas'
import { Composer } from '@/components/demo/Composer'
import { Readout, type Extraction } from '@/components/demo/Readout'
import { sendMessage, chatById, overlaps, type DemoGraph } from '@/demo/graph'
import { seededGraph } from '@/demo/seed'
import { writtenReply } from '@/demo/reply'
import { extractConcepts } from '@/lib/extract'
import { canonicalKey } from '@/lib/text'

/**
 * Minddyte's live demo.
 *
 * Everything the canvas shows is computed by the application's own code:
 * `lib/extract.ts` finds the concepts, `lib/text.ts` decides their identity,
 * and `lib/compaction.ts` builds the memory. What is missing compared to the
 * real app is the database underneath and the model on top — and since the
 * graph is authored deterministically, removing the model removes nothing the
 * graph depended on.
 *
 * The page is deliberately honest about which half is which; see the banner.
 */

const YOUR_CHAT = 'you'

export default function DemoPage() {
  // Lazy, so the seed is folded through the real ingest path exactly once.
  const [graph, setGraph] = useState<DemoGraph>(() => seededGraph())
  const [extraction, setExtraction] = useState<Extraction | null>(null)
  const [newKeys, setNewKeys] = useState<string[]>([])

  function handleSend(text: string) {
    // Captured BEFORE ingest: afterwards every key is present, and "was this
    // already here?" can no longer be answered.
    const before = new Set(graph.nodes.map((n) => n.key))

    const { auto, suggested } = extractConcepts(text)
    const keys = auto.map(canonicalKey).filter(Boolean)
    const connected = auto.filter((label) => before.has(canonicalKey(label)))

    const assistantText = writtenReply({ auto, connected, suggested })

    setGraph(sendMessage(graph, { chatId: YOUR_CHAT, userText: text, assistantText }))
    setExtraction({ auto, connected, suggested })
    setNewKeys(keys)
  }

  function reset() {
    setGraph(seededGraph())
    setExtraction(null)
    setNewKeys([])
  }

  const yours = chatById(graph, YOUR_CHAT)
  const shared = graph.nodes.filter((n) => n.chatIds.length > 1).length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      <header
        style={{
          borderBottom: '1px solid var(--border)',
          background: 'var(--white)',
          padding: '11px 18px',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          flexShrink: 0,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: '50%',
              background: 'var(--violet)',
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Brain size={14} />
          </div>
          <span
            style={{ fontSize: 15, fontWeight: 600, fontFamily: "'Fraunces',serif" }}
          >
            Minddyte
          </span>
        </div>

        <p
          style={{
            flex: 1,
            minWidth: 260,
            fontSize: 11.5,
            lineHeight: 1.5,
            color: 'var(--ink2)',
            margin: 0,
          }}
        >
          <strong style={{ color: 'var(--violet)' }}>Live demo.</strong> The replies
          here are written, not generated — but the knowledge graph is built by the
          real extractor, in your browser, from whatever you type. Minddyte&rsquo;s
          graph never needed a model to build it.
        </p>

        <button
          onClick={reset}
          className="btn-ghost"
          style={{
            fontSize: 11.5,
            gap: 5,
            padding: '5px 10px',
            color: 'var(--ink2)',
            fontFamily: 'inherit',
          }}
        >
          <RotateCcw size={12} />
          Reset
        </button>
      </header>

      <div className="demo-body">
        <main className="demo-canvas">
          <GraphCanvas graph={graph} yourChatId={YOUR_CHAT} newKeys={newKeys} />

          <div
            style={{
              position: 'absolute',
              left: 14,
              bottom: 14,
              display: 'flex',
              gap: 14,
              padding: '7px 13px',
              borderRadius: 8,
              background: 'rgba(255,255,255,.92)',
              border: '1px solid var(--border)',
              fontSize: 11,
              color: 'var(--ink2)',
              pointerEvents: 'none',
            }}
          >
            <span>
              <strong style={{ color: 'var(--ink)' }}>{graph.chats.length}</strong>{' '}
              conversations
            </span>
            <span>
              <strong style={{ color: 'var(--ink)' }}>{graph.nodes.length}</strong> concepts
            </span>
            <span>
              <strong style={{ color: 'var(--violet)' }}>{shared}</strong> shared
            </span>
            <span>
              <strong style={{ color: 'var(--violet)' }}>{overlaps(graph).length}</strong>{' '}
              connections
            </span>
          </div>
        </main>

        <aside className="demo-aside">
          <Composer onSend={handleSend} />
          <Readout extraction={extraction} compaction={yours?.compaction ?? ''} />
        </aside>
      </div>
    </div>
  )
}
