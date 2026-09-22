import type { ViewGraph } from '@/types/graph'

/**
 * Where things sit on the canvas.
 *
 * Deterministic on purpose: the same graph must produce the same picture every
 * time. A force simulation would drift between reloads, so a visitor who
 * reloads mid-demo would see a different arrangement and reasonably conclude
 * the positions mean nothing. These do mean something — distance from the
 * centre is how many conversations a concept holds together.
 *
 * Chats sit on a ring. A concept sits at the centre of gravity of the chats
 * that hold it, so a concept shared by three conversations is pulled to the
 * middle while a concept only one chat mentions drifts out past its own chat.
 * That is the whole visual argument of the product, and it falls out of the
 * arithmetic rather than being staged.
 */

export type Placed = { id: string; x: number; y: number }
/** A placed item with the space it actually occupies. */
type Box = Placed & { w: number; h: number }
export type Layout = { chats: Placed[]; concepts: Placed[] }

const RING_RADIUS = 330
/**
 * The ring is an ELLIPSE, not a circle. A browser window is landscape and a
 * circular arrangement fits it by height, leaving a wide empty margin down
 * each side while the middle stays congested. Stretching the ring to roughly
 * the proportions of the viewport spends that margin on the graph instead.
 *
 * Do not overshoot it either: the frame fits the whole bounding box, so a ring
 * wider than the window becomes width-constrained and gives the empty margin
 * back along the top and bottom. These values put the box near 1.4:1, close to
 * a laptop canvas once the side panel is taken out.
 */
const RING_X = 1.3
const RING_Y = 0.94
/** How far past its chat a single-chat concept floats. */
const ORBIT = 1.42
/** Bounded offset that keeps sibling concepts off each other, stable per key. */
const JITTER = 58
/**
 * Clear space demanded around every label, measured from its EDGES.
 *
 * An earlier version separated centre points by a fixed distance, which is
 * wrong the moment labels differ in width: "Docker Compose" is about 150px
 * across and "Rust" about 80, so their half-widths already sum past any
 * centre-to-centre figure that looks reasonable for the short ones, and the
 * two rendered on top of each other. Boxes, not points.
 */
const MARGIN = 24

/** Rough advance width of the pill face at 13px; only used to size a box. */
const CHAR_W = 7.2
const PILL_PAD = 32
const BADGE_W = 34
const PILL_H = 34
/** Fixed in ChatNode. */
const CARD_W = 208
const CARD_H = 104
/**
 * Enough passes for the gaps above to be satisfied on graphs this size, and
 * few enough to stay instant. Relaxation is deterministic, so this is a fixed
 * cost rather than a convergence check.
 */
const RELAX_PASSES = 60

/** djb2, kept because it is short, stable across runs, and has no dependencies. */
function hash(key: string): number {
  let h = 5381
  for (let i = 0; i < key.length; i++) h = ((h << 5) + h + key.charCodeAt(i)) | 0
  return Math.abs(h)
}

/** A repeatable offset in [-JITTER, JITTER], derived from the key alone. */
function jitter(key: string, axis: number): number {
  const h = hash(key + ':' + axis)
  return ((h % 2001) / 1000 - 1) * JITTER
}

/**
 * The width a concept pill will render at. Exported so the tests can assert
 * that no two labels overlap without restating the arithmetic.
 */
export function conceptWidth(label: string, shared: boolean): number {
  return label.length * CHAR_W + PILL_PAD + (shared ? BADGE_W : 0)
}
export const CONCEPT_HEIGHT = PILL_H
export const CARD_SIZE = { w: CARD_W, h: CARD_H }

export function layoutGraph(graph: ViewGraph, radius = RING_RADIUS): Layout {
  const n = Math.max(graph.chats.length, 1)

  const chatAt = new Map<string, Placed>()
  graph.chats.forEach((chat, i) => {
    // Start at the top and go clockwise, so the first seeded chat is where the
    // eye lands rather than off to the right.
    const angle = (2 * Math.PI * i) / n - Math.PI / 2
    chatAt.set(chat.id, {
      id: chat.id,
      x: Math.cos(angle) * radius * RING_X,
      y: Math.sin(angle) * radius * RING_Y,
    })
  })

  const concepts: Box[] = graph.nodes.map((node) => {
    const shared = node.chatIds.length > 1
    const w = conceptWidth(node.label, shared)
    const held = node.chatIds.map((id) => chatAt.get(id)).filter((p): p is Placed => !!p)

    // A concept whose chats have all been removed would otherwise divide by
    // zero; park it at the origin rather than produce NaN and blank the canvas.
    if (held.length === 0) {
      return { id: node.key, x: jitter(node.key, 0), y: jitter(node.key, 1), w, h: PILL_H }
    }

    const cx = held.reduce((s, p) => s + p.x, 0) / held.length
    const cy = held.reduce((s, p) => s + p.y, 0) / held.length

    // One chat means the centroid IS that chat, which would bury the label
    // under the chat card. Push it outward instead, where it reads as hanging
    // off its own conversation.
    const scale = held.length === 1 ? ORBIT : 1
    return {
      id: node.key,
      x: cx * scale + jitter(node.key, 0),
      y: cy * scale + jitter(node.key, 1),
      w,
      h: PILL_H,
    }
  })

  const chats = [...chatAt.values()]
  const chatBoxes: Box[] = chats.map((c) => ({ ...c, w: CARD_W, h: CARD_H }))
  return { chats, concepts: relax(concepts, chatBoxes) }
}

/**
 * Push overlapping labels apart.
 *
 * The centroid rule is what makes the picture mean something, but it puts
 * every widely shared concept in roughly the same place: with five chats on a
 * ring, the centre of gravity of any two or three of them lands near the
 * middle. Measured on the seeded graph, five shared concepts stacked into an
 * unreadable pile there.
 *
 * So the centroid decides where a concept WANTS to be, and this decides where
 * it can actually fit. Displacement is small relative to the ring, which keeps
 * "close to the middle means widely shared" true while making the labels
 * legible.
 *
 * Deterministic: fixed pass count, fixed iteration order, and the tie-break
 * for two boxes at the same point comes from the key hash rather than a random
 * direction. The same graph still draws the same picture.
 */
function relax(concepts: Box[], chats: Box[]): Placed[] {
  const out = concepts.map((b) => ({ ...b }))

  for (let pass = 0; pass < RELAX_PASSES; pass++) {
    for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        separate(out[i], out[j], true)
      }
    }
    // Chats hold the ring; only the concept yields.
    for (const concept of out) {
      for (const chat of chats) separate(concept, chat, false)
    }
  }

  return out.map(({ id, x, y }) => ({ id, x, y }))
}

/**
 * Move `a` (and `b`, when `b` may yield) clear of each other.
 *
 * Two boxes are apart when a gap exists on EITHER axis, so the cheapest way
 * out is along whichever axis they overlap least — pushing on the other would
 * travel the long way round for the same result. Boxes sharing an exact centre
 * have no direction at all, so one is taken from the key hash: stable across
 * runs, and never zero.
 */
function separate(a: Box, b: Box, bYields: boolean): void {
  const dx = a.x - b.x
  const dy = a.y - b.y
  const overlapX = (a.w + b.w) / 2 + MARGIN - Math.abs(dx)
  const overlapY = (a.h + b.h) / 2 + MARGIN - Math.abs(dy)

  if (overlapX <= 0 || overlapY <= 0) return

  const share = bYields ? 2 : 1

  if (overlapX < overlapY) {
    const dir = dx === 0 ? (hash(a.id) % 2 ? 1 : -1) : Math.sign(dx)
    a.x += (dir * overlapX) / share
    if (bYields) b.x -= (dir * overlapX) / share
  } else {
    const dir = dy === 0 ? (hash(a.id) % 2 ? 1 : -1) : Math.sign(dy)
    a.y += (dir * overlapY) / share
    if (bYields) b.y -= (dir * overlapY) / share
  }
}
