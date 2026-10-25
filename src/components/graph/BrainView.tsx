'use client'

import dynamic from 'next/dynamic'
import { useEffect, useMemo, useRef, useState } from 'react'
import { overlaps } from '@/lib/graph-overlaps'
import type { ViewGraph } from '@/types/graph'
import { BrainList } from './BrainList'
import { ChatDetails, ConceptDetails, type DetailActions } from './BrainDetails'
import type { Selection } from './sigma/brainGraph'

/**
 * The Neural Brain tab: the bar that explains how to read the map, the map,
 * and the same content as a list beside it.
 *
 * The strip sits above the canvas rather than floating on it. Floated, it
 * overlapped the cards underneath — and a panel covering the thing it
 * describes is worse than no panel.
 *
 * Reset used to live at the end of this bar. It is in the nav now: it applies
 * to the whole demo, not to this tab, and a control that resets everything
 * should not be findable from only one of three places.
 *
 * The map is WebGL, which needs `window`, so it loads in the browser only.
 *
 * The map draws chats and the concepts that link them, nothing else: the
 * concepts only one chat has are counted on its card ("+N concepts") and
 * named in its panel (see `mapGraph`). Zoomed far out, even the linked ones
 * fade away and only the cards remain (see `CONCEPT_FADE`).
 */
const SigmaBrain = dynamic(() => import('./SigmaBrain').then((m) => m.SigmaBrain), {
  ssr: false,
  loading: () => <div className="brain-stage" aria-hidden="true" />,
})

function Stat({ value, label, accent }: { value: number; label: string; accent?: boolean }) {
  return (
    <div>
      <div
        className="tnum"
        style={{
          fontSize: 19,
          fontWeight: 600,
          lineHeight: 1,
          letterSpacing: '-.02em',
          color: accent ? 'var(--violet)' : 'var(--ink)',
        }}
      >
        {value}
      </div>
      <div className="demo-eyebrow" style={{ marginTop: 5 }}>
        {label}
      </div>
    </div>
  )
}

function Key({ swatch, children }: { swatch: 'chat' | 'mine' | 'shared' | 'count'; children: React.ReactNode }) {
  if (swatch === 'count') {
    return (
      <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <span className="brain-key-count tnum" aria-hidden="true">
          +N
        </span>
        <span style={{ fontSize: 11.5, color: 'var(--ink2)' }}>{children}</span>
      </span>
    )
  }
  const style = {
    chat: { background: 'var(--white)', border: '1px solid var(--border)', borderRadius: 3 },
    mine: { background: 'var(--violet)', border: '1px solid var(--violet)', borderRadius: 3 },
    shared: { background: 'var(--violet)', border: '1px solid var(--violet)', borderRadius: 999 },
  }[swatch]

  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
      <span style={{ ...style, width: 18, height: 11, flexShrink: 0 }} aria-hidden="true" />
      <span style={{ fontSize: 11.5, color: 'var(--ink2)' }}>{children}</span>
    </span>
  )
}

/** The width under which the map and the list take turns instead of sitting side by side. Matches global.css. */
const NARROW = '(max-width: 860px)'

export function BrainView({
  graph,
  highlight,
  highlightLabel,
  focusId,
  onOpenChat,
  onUseChat,
  onForget,
}: {
  graph: ViewGraph
  /**
   * Conversations to fill violet. The demo marks the ones the visitor started;
   * the app marks the one they have open. Same treatment, different meaning,
   * which is why the label travels with it.
   */
  highlight: string[]
  highlightLabel: string
  /** The conversation the first frame centres on. */
  focusId: string | null
  onOpenChat: (id: string) => void
  /** Bring a chat into the next message, as picking it from `@` does. */
  onUseChat?: (id: string) => void
  /** Open the forget confirmation for one concept in one chat. */
  onForget: (chatId: string, key: string) => void
}) {
  const [pick, setPick] = useState<{ sel: Selection; from: 'map' | 'list' } | null>(null)
  /** Narrow screens only: which of the two is on screen. */
  const [view, setView] = useState<'map' | 'list'>('map')
  const [mapOff, setMapOff] = useState(false)
  /** The list button a selection came from, so closing the panel can put focus back. */
  const returnTo = useRef<HTMLElement | null>(null)

  // The parent builds a fresh array on every render. Keyed by its contents,
  // the map is rebuilt only when the highlighted chats actually change.
  const highlightKey = highlight.join('\n')
  const stableHighlight = useMemo(() => (highlightKey ? highlightKey.split('\n') : []), [highlightKey])

  // A selection only stands while its node is on the map. After a forget it
  // may not be, and a panel pinned to nothing would float in a corner.
  const sel = pick?.sel ?? null
  const chat = sel?.kind === 'chat' ? graph.chats.find((c) => c.id === sel.id) : undefined
  const concept = sel?.kind === 'concept' ? graph.nodes.find((n) => n.key === sel.key) : undefined
  const current = chat || concept ? pick : null

  const close = () => {
    setPick(null)
    const back = returnTo.current
    returnTo.current = null
    if (back?.isConnected) back.focus()
  }

  // Esc closes the panel, unless a dialog (the forget confirmation) is the
  // thing Esc is meant for right now.
  useEffect(() => {
    if (!current) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      if (document.querySelector('[aria-modal="true"]')) return
      close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // After a forget the graph is read again, and the chip whose × had focus is
  // gone with it, so the browser drops focus to the page. Put it back on the
  // panel's title, where the keyboard was working a moment ago.
  useEffect(() => {
    if (document.activeElement !== document.body) return
    document.getElementById('brain-panel-title')?.focus({ preventScroll: true })
  }, [graph])

  // A pick from the list, or from inside the panel, moves focus into the panel
  // so its buttons are the next Tab stop. A click on the map leaves focus be.
  useEffect(() => {
    if (pick?.from !== 'list') return
    const raf = requestAnimationFrame(() =>
      document.getElementById('brain-panel-title')?.focus({ preventScroll: true }),
    )
    return () => cancelAnimationFrame(raf)
  }, [pick])

  const actions: DetailActions = {
    onSelect: (s) => setPick({ sel: s, from: 'list' }),
    onOpenChat,
    onUseChat,
    onForget,
    onClose: close,
  }

  let panel: React.ReactNode = null
  if (current && chat) {
    panel = (
      <ChatDetails
        key={chat.id}
        chat={chat}
        concepts={graph.nodes.filter((n) => n.chatIds.includes(chat.id))}
        isOpen={stableHighlight.includes(chat.id)}
        openLabel={highlightLabel}
        actions={actions}
      />
    )
  } else if (current && concept) {
    panel = (
      <ConceptDetails
        key={concept.key}
        concept={concept}
        chats={graph.chats.filter((c) => concept.chatIds.includes(c.id))}
        openId={focusId}
        actions={actions}
      />
    )
  }

  const shared = graph.nodes.filter((n) => n.chatIds.length > 1).length
  const lone = graph.nodes.length - shared

  return (
    <div className="demo-pane" style={{ width: '100%' }}>
      <div className="demo-stats">
        <Stat value={graph.chats.length} label="conversations" />
        <Stat value={graph.nodes.length} label="concepts" />
        <Stat value={shared} label="shared" accent />
        <Stat value={overlaps(graph).length} label="links" accent />

        <div className="rule" aria-hidden="true" />

        <div className="demo-legend">
          <span className="brain-key-chat">
            <Key swatch="chat">A conversation</Key>
          </span>
          {highlight.length > 0 && <Key swatch="mine">{highlightLabel}</Key>}
          <Key swatch="shared">Shared concept — its badge counts them</Key>
          {lone > 0 && <Key swatch="count">Concepts only that chat has</Key>}
        </div>

        <div className="brain-tools">
          {!mapOff && (
            <div className="brain-switch" role="group" aria-label="Show the Brain as">
              <button type="button" aria-pressed={view === 'map'} onClick={() => setView('map')}>
                Map
              </button>
              <button type="button" aria-pressed={view === 'list'} onClick={() => setView('list')}>
                List
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="brain-body" data-view={mapOff ? 'list' : view} data-map={mapOff ? 'off' : 'on'}>
        <div className="brain-map">
          <SigmaBrain
            graph={graph}
            highlight={stableHighlight}
            highlightLabel={highlightLabel}
            focusId={focusId}
            selected={current?.sel ?? null}
            selectedFrom={current?.from ?? 'map'}
            onSelect={(s) => {
              returnTo.current = null
              setPick(s ? { sel: s, from: 'map' } : null)
            }}
            panel={panel}
            onUnavailable={() => setMapOff(true)}
          />
        </div>
        <BrainList
          graph={graph}
          openId={focusId}
          openLabel={highlightLabel}
          selected={current?.sel ?? null}
          onPick={(s, from) => {
            returnTo.current = from
            setPick({ sel: s, from: 'list' })
            // On a phone the list and the map take turns: show the pick.
            if (!mapOff && window.matchMedia(NARROW).matches) setView('map')
          }}
        />
      </div>
    </div>
  )
}
