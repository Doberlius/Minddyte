import type { ViewGraph } from '@/types/graph'
import type { Layout } from '@/lib/graph-layout'
import { CARD_SIZE } from '@/lib/graph-layout'

/**
 * From the Brain's data to what Sigma draws: one entry per card, pill and
 * line, with its position, size and colours worked out.
 *
 * Kept free of Sigma, graphology and the browser on purpose, so the rules
 * that decide what appears on the map can be tested in plain Node: which
 * concepts are drawn, what each "+N concepts" count says, which card is
 * filled violet.
 */

/** The colours the canvas uses, read once from the CSS tokens in global.css. */
export type BrainPalette = {
  surface: string
  ink: string
  ink2: string
  ink3: string
  violet: string
  border: string
  pillBorder: string
  lineQuiet: string
  lineStrong: string
}

export type NodeKind = 'chat' | 'shared'

export type BrainNodeAttributes = {
  x: number
  y: number
  /** Half the height, in graph units. Sigma calls it size. */
  size: number
  /** Width over height (see CardProgram). */
  aspect: number
  /** Corner as a fraction of half the height; 1 makes a pill. */
  radius: number
  color: string
  borderColor: string
  label: string
  kind: NodeKind
  /** Cards draw above pills, so a pill pushed against a card never covers it. */
  zIndex: number
  /** Every card and pill gets its text; drawCard decides when it is too small to read. */
  forceLabel: true
  /** Drawn with the persistent ring (the selected node). Sigma reads this name. */
  highlighted: boolean
  /** Chats only. */
  messages?: number
  /**
   * Chats only: how many concepts only this chat holds, the "+N" on its card
   * (they are never drawn themselves; see `mapGraph`).
   * Not called `hidden`: Sigma reads an attribute of that name as "do not
   * draw this node", and every chat with a count vanished.
   */
  extra?: number
  /** Chats only: deriveTitle cut the title at its cap. */
  truncated?: boolean
  /** Chats only: filled violet (the chat you have open). */
  mine?: boolean
  /** Chats only: the eyebrow on a filled card. */
  mineLabel?: string
  /** Concepts only: how many chats hold it. */
  count?: number
  /**
   * The zoom range over which this node fades in (see `CONCEPT_FADE`). Both
   * 0 means always fully drawn. CardProgram reads these on the GPU.
   */
  fadeFrom: number
  fadeTo: number
}

export type BrainEdgeAttributes = {
  size: number
  color: string
  /** Sigma skips a hidden edge entirely. Set while its concept has faded out. */
  hidden?: boolean
}

export type BrainGraphData = {
  nodes: { key: string; attributes: BrainNodeAttributes }[]
  edges: { source: string; target: string; attributes: BrainEdgeAttributes }[]
}

/** The id a chat or concept has on the canvas. Prefixed so a chat id can never collide with a concept key. */
export const chatNodeId = (id: string) => `chat:${id}`
export const conceptNodeId = (key: string) => `node:${key}`

/** What is selected on the map, in the list, or both: they always agree. */
export type Selection = { kind: 'chat'; id: string } | { kind: 'concept'; key: string }

export const nodeIdOf = (s: Selection) => (s.kind === 'chat' ? chatNodeId(s.id) : conceptNodeId(s.key))

export function selectionOf(nodeId: string): Selection | null {
  if (nodeId.startsWith('chat:')) return { kind: 'chat', id: nodeId.slice(5) }
  if (nodeId.startsWith('node:')) return { kind: 'concept', key: nodeId.slice(5) }
  return null
}

/** Fixed in the card renderer: a chat card is CARD_SIZE, so half its height is the size. */
export const CHAT_SIZE = CARD_SIZE.h / 2
/** A pill is 28px tall at zoom 1; the layout keeps a 34px box around it so neighbours breathe. */
export const PILL_SIZE = 14

/**
 * What the map draws: chats, and the concepts that LINK them.
 *
 * Most concepts belong to one chat only. They say nothing about how chats
 * connect, which is the question the Brain is for, and one chat with a pasted
 * essay holds hundreds of them, so they are not drawn at all, at any zoom.
 * Each card counts its own instead ("+214 concepts"), and the chat's panel
 * lists them by name.
 */
export function mapGraph(graph: ViewGraph): ViewGraph {
  return { chats: graph.chats, nodes: graph.nodes.filter((n) => n.chatIds.length > 1) }
}

/**
 * Zoomed far out, even the shared concepts are clutter: a field of violet
 * blobs and crossing lines over cards too small to read. So they fade in
 * with the zoom, and from far away the map is chat cards only.
 *
 * The range is in `k`, screen pixels per graph unit (1 = the size the layout
 * was drawn at). It ends below the 0.6 the first frame is held to, so the map
 * always OPENS with its links showing; it takes zooming out past that to lose
 * them. It starts just above where card titles stop being drawn (13px times k
 * under 5px, so k near 0.38), so the two quiet down together.
 */
export const CONCEPT_FADE = { from: 0.32, to: 0.5 } as const

/** How visible a concept is at zoom `k`: 0 to 1, eased (GLSL's smoothstep, so the GPU and the canvas agree). */
export function fadeAt(k: number, from: number = CONCEPT_FADE.from, to: number = CONCEPT_FADE.to): number {
  if (to <= 0) return 1
  const t = Math.min(1, Math.max(0, (k - from) / (to - from)))
  return t * t * (3 - 2 * t)
}

/** Per chat, how many concepts only it holds: the "+N" on its card. */
export function loneCounts(graph: ViewGraph): Map<string, number> {
  const counts = new Map<string, number>()
  for (const node of graph.nodes) {
    if (node.chatIds.length !== 1) continue
    const id = node.chatIds[0]
    counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  return counts
}

/**
 * A colour at `alpha`, premultiplied: Sigma blends lines as premultiplied
 * colour but does not premultiply them itself, so a plain rgba line at 25%
 * came out nearly white instead of faint.
 */
export function fadedColor(hex: string, alpha: number): string {
  const n = parseInt(hex.replace('#', ''), 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  const a = Math.round(alpha * 1000) / 1000
  return `rgba(${Math.round(r * a)},${Math.round(g * a)},${Math.round(b * a)},${a})`
}

/** The fill and outline of each kind of node. Selection never changes these; it adds a ring. */
export function nodeColors(kind: NodeKind, mine: boolean, p: BrainPalette) {
  if (kind === 'chat') return mine ? { color: p.violet, borderColor: p.violet } : { color: p.surface, borderColor: p.border }
  return { color: p.violet, borderColor: p.violet }
}

/**
 * `graph` is the full graph (the "+N" counts come from it); `layout` must be
 * the layout of `mapGraph(graph)`, which is what gets drawn.
 */
export function buildBrainGraph(
  graph: ViewGraph,
  layout: Layout,
  opts: {
    /** Chats to fill violet. */
    highlight: string[]
    highlightLabel: string
    palette: BrainPalette
    /** A pill's drawn width at zoom 1. Measured on a canvas in the browser; estimated in tests. */
    pillWidth: (label: string) => number
  },
): BrainGraphData {
  const lone = loneCounts(graph)
  const at = new Map([...layout.chats, ...layout.concepts].map((p) => [p.id, p]))
  const mine = new Set(opts.highlight)
  const nodes: BrainGraphData['nodes'] = []
  const edges: BrainGraphData['edges'] = []

  for (const chat of graph.chats) {
    const p = at.get(chat.id)
    if (!p) continue
    const isMine = mine.has(chat.id)
    nodes.push({
      key: chatNodeId(chat.id),
      attributes: {
        // Sigma's y axis points up; the layout's, like the screen's, points down.
        x: p.x,
        y: -p.y,
        size: CHAT_SIZE,
        aspect: CARD_SIZE.w / CARD_SIZE.h,
        // 10px corners on a 104px card.
        radius: 10 / CHAT_SIZE,
        ...nodeColors('chat', isMine, opts.palette),
        label: chat.title,
        kind: 'chat',
        zIndex: 2,
        forceLabel: true,
        highlighted: false,
        messages: chat.messageCount,
        extra: lone.get(chat.id) ?? 0,
        truncated: chat.titleTruncated,
        mine: isMine,
        mineLabel: opts.highlightLabel,
        fadeFrom: 0,
        fadeTo: 0,
      },
    })
  }

  const chatIds = new Set(graph.chats.map((c) => c.id))
  for (const node of graph.nodes) {
    // Lone concepts are never drawn (see `mapGraph`).
    if (node.chatIds.length < 2) continue
    const p = at.get(node.key)
    if (!p) continue
    const id = conceptNodeId(node.key)
    nodes.push({
      key: id,
      attributes: {
        x: p.x,
        y: -p.y,
        size: PILL_SIZE,
        aspect: opts.pillWidth(node.label) / (PILL_SIZE * 2),
        radius: 1,
        ...nodeColors('shared', false, opts.palette),
        label: node.label,
        kind: 'shared',
        zIndex: 1,
        forceLabel: true,
        highlighted: false,
        count: node.chatIds.length,
        fadeFrom: CONCEPT_FADE.from,
        fadeTo: CONCEPT_FADE.to,
      },
    })
    for (const chatId of node.chatIds) {
      // A concept can outlive a chat for one fetch; a line to nowhere would throw in graphology.
      if (!chatIds.has(chatId)) continue
      // Every line leads to a shared concept, so every line gets the weight.
      edges.push({ source: chatNodeId(chatId), target: id, attributes: { size: 1.9, color: opts.palette.lineStrong } })
    }
  }

  return { nodes, edges }
}
