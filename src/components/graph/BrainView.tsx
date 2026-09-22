'use client'

import { GraphCanvas } from './GraphCanvas'
import { overlaps } from '@/lib/graph-overlaps'
import type { ViewGraph } from '@/types/graph'

/**
 * The Neural Brain tab: the graph, with the bar that explains how to read it.
 *
 * The strip sits above the canvas rather than floating on it. Floated, it
 * overlapped the cards underneath — and a panel covering the thing it
 * describes is worse than no panel.
 *
 * Reset used to live at the end of this bar. It is in the nav now: it applies
 * to the whole demo, not to this tab, and a control that resets everything
 * should not be findable from only one of three places.
 */

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

function Key({ swatch, children }: { swatch: 'chat' | 'mine' | 'shared' | 'lone'; children: React.ReactNode }) {
  const style = {
    chat: { background: 'var(--white)', border: '1px solid var(--border)', borderRadius: 3 },
    mine: { background: 'var(--violet)', border: '1px solid var(--violet)', borderRadius: 3 },
    shared: { background: 'var(--violet)', border: '1px solid var(--violet)', borderRadius: 999 },
    lone: { background: 'var(--white)', border: '1px solid var(--pill-border)', borderRadius: 999 },
  }[swatch]

  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
      <span style={{ ...style, width: 18, height: 11, flexShrink: 0 }} aria-hidden="true" />
      <span style={{ fontSize: 11.5, color: 'var(--ink2)' }}>{children}</span>
    </span>
  )
}

export function BrainView({
  graph,
  highlight,
  highlightLabel,
  focusId,
  newKeys,
}: {
  graph: ViewGraph
  /**
   * Conversations to fill violet. The demo marks the ones the visitor started;
   * the app marks the one they have open. Same treatment, different meaning,
   * which is why the label travels with it.
   */
  highlight: string[]
  highlightLabel: string
  /** The conversation a refit frames. */
  focusId: string | null
  newKeys: string[]
}) {
  const shared = graph.nodes.filter((n) => n.chatIds.length > 1).length

  return (
    <div className="demo-pane" style={{ width: '100%' }}>
      <div className="demo-stats">
        <Stat value={graph.chats.length} label="conversations" />
        <Stat value={graph.nodes.length} label="concepts" />
        <Stat value={shared} label="shared" accent />
        <Stat value={overlaps(graph).length} label="links" accent />

        <div className="rule" aria-hidden="true" />

        <div className="demo-legend">
          <Key swatch="chat">A conversation</Key>
          {highlight.length > 0 && <Key swatch="mine">{highlightLabel}</Key>}
          <Key swatch="shared">Shared concept — its badge counts them</Key>
          <Key swatch="lone">Mentioned once</Key>
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0 }}>
        <GraphCanvas
          graph={graph}
          highlight={highlight}
          highlightLabel={highlightLabel}
          focusId={focusId}
          newKeys={newKeys}
        />
      </div>
    </div>
  )
}
