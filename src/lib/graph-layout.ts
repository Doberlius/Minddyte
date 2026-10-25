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
export type Box = Placed & { w: number; h: number }
export type Layout = { chats: Placed[]; concepts: Placed[] }

/** The smallest ring. It grows when the chats or the concepts need more room (see `ringRadius`). */
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
/**
 * Clear space between a concept and a chat card, measured from their EDGES.
 *
 * An earlier version separated centre points by a fixed distance, which is
 * wrong the moment labels differ in width: "Docker Compose" is about 150px
 * across and "Rust" about 80, so their half-widths already sum past any
 * centre-to-centre figure that looks reasonable for the short ones, and the
 * two rendered on top of each other. Boxes, not points.
 */
const MARGIN = 24
/**
 * Clear space between two concepts. Tighter than around a card: a cluster of
 * pills reads as one group when they sit close, and a big cluster at the
 * card margin spread over twice the screen.
 */
const GAP_X = 12
const GAP_Y = 8

/** Rough advance width of the pill face at 13px; only used to size a box. */
const CHAR_W = 7.2
const PILL_PAD = 32
const BADGE_W = 34
const PILL_H = 34
/** Fixed in the card renderer (drawCard.ts). */
const CARD_W = 208
const CARD_H = 104

/**
 * The width a concept pill will render at, estimated from its length. The
 * map passes its own measured widths instead (`widthOf`); this is the
 * fallback, and what the tests assert against.
 */
export function conceptWidth(label: string, shared: boolean): number {
  return label.length * CHAR_W + PILL_PAD + (shared ? BADGE_W : 0)
}
export const CONCEPT_HEIGHT = PILL_H
export const CARD_SIZE = { w: CARD_W, h: CARD_H }

/**
 * How big the ring must be: never below RING_RADIUS, and big enough for two
 * things that used to be ignored.
 *
 * - The cards themselves. Twenty-eight cards on a ring sized for five sat on
 *   top of each other. Cards are spread evenly by angle, and at the top of
 *   the ellipse neighbours sit side by side, so the arc there (RING_X · R per
 *   radian) must hold a card's width plus a gap.
 * - The concepts. Hundreds of them need an area to sit in, and a ring that
 *   ignores that crams them over the cards. The ellipse's area is made at
 *   least the area the concepts take up.
 */
function ringRadius(chats: number, conceptArea: number): number {
  const byCards = (chats * (CARD_W + 40)) / (2 * Math.PI * RING_X)
  const byConcepts = Math.sqrt(conceptArea / (Math.PI * RING_X * RING_Y))
  return Math.max(RING_RADIUS, byCards, byConcepts)
}

export function layoutGraph(
  graph: ViewGraph,
  opts: {
    /** A fixed ring instead of one sized to the graph. */
    radius?: number
    /** Real pill widths (the map measures its text); the estimate otherwise. */
    widthOf?: (label: string, shared: boolean) => number
  } = {},
): Layout {
  const widthOf = opts.widthOf ?? conceptWidth
  const n = Math.max(graph.chats.length, 1)
  const widths = graph.nodes.map((node) => widthOf(node.label, node.chatIds.length > 1))
  const area = widths.reduce((s, w) => s + (w + GAP_X) * (PILL_H + GAP_Y), 0)
  const radius = opts.radius ?? ringRadius(n, area)

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

  // Where each concept WANTS to be. `place` then decides where it fits.
  const wanted: Box[] = graph.nodes.map((node, i) => {
    const w = widths[i]
    const held = node.chatIds.map((id) => chatAt.get(id)).filter((p): p is Placed => !!p)

    // A concept whose chats have all been removed would otherwise divide by
    // zero; park it at the origin rather than produce NaN and blank the canvas.
    if (held.length === 0) return { id: node.key, x: 0, y: 0, w, h: PILL_H }

    const cx = held.reduce((s, p) => s + p.x, 0) / held.length
    const cy = held.reduce((s, p) => s + p.y, 0) / held.length

    // One chat means the centroid IS that chat, which would bury the label
    // under the chat card. Push it outward instead, where it reads as hanging
    // off its own conversation.
    const scale = held.length === 1 ? ORBIT : 1
    return { id: node.key, x: cx * scale, y: cy * scale, w, h: PILL_H }
  })

  // The most widely shared go first, so they get the spots nearest their
  // centre: "closer to the middle means more conversations" stays true.
  const order = graph.nodes
    .map((node, i) => ({ i, held: node.chatIds.length }))
    .sort((a, b) => b.held - a.held || a.i - b.i)
    .map((o) => o.i)

  const chats = [...chatAt.values()]
  const cards: Box[] = chats.map((c) => ({ ...c, w: CARD_W, h: CARD_H }))
  place(order.map((i) => wanted[i]), cards)
  return { chats, concepts: wanted.map(({ id, x, y }) => ({ id, x, y })) }
}

/**
 * Put every concept in the nearest free spot to where it wants to be, one at
 * a time, so no two can overlap.
 *
 * This replaced pushing overlapping pairs apart, which failed on real data:
 * one article pasted into three chats gave three hundred concepts the very
 * same wanted spot, and a pile of three hundred never untangles by nudging
 * pairs. Placing them instead cannot overlap, by construction.
 *
 * The search walks outward from the wanted spot along a sunflower spiral
 * (each point a golden angle round from the last, at a radius growing with
 * the square root of its number), which visits points at an even density.
 * It is stretched sideways because pills are wide and short, so a cluster
 * comes out as rows rather than a tall column.
 *
 * Concepts that want the same spot continue the search where the last one
 * ended, a little before it: the spots closer in are already taken, and
 * walking them again for every one of three hundred concepts is what would
 * make this slow.
 *
 * Deterministic: a fixed order, a fixed spiral, no randomness. Moves the
 * boxes in `boxes` in place; the cards in `fixed` never move.
 */
function place(boxes: Box[], fixed: Box[]): void {
  // A loop, not Math.max(...spread): spreading thousands of arguments can
  // overflow the call stack.
  const widest = [...fixed, ...boxes].reduce((w, b) => Math.max(w, b.w), 0)
  // Two boxes can only clash when their centres are under (wa + wb) / 2 plus
  // the gap apart, at most `widest + MARGIN`. With cells that size, any clash
  // is in the same or a neighbouring cell, so only those 9 are checked.
  const cell = widest + MARGIN
  const cellOf = (v: number) => Math.floor(v / cell)
  /** One number per cell, so the Map hashes a number rather than a "3,-2" string. */
  const keyOf = (gx: number, gy: number) => gx * 1_000_003 + gy
  const grid = new Map<number, { b: Box; card: boolean }[]>()
  const occupy = (b: Box, card: boolean) => {
    const key = keyOf(cellOf(b.x), cellOf(b.y))
    const list = grid.get(key)
    if (list) list.push({ b, card })
    else grid.set(key, [{ b, card }])
  }
  const free = (x: number, y: number, w: number, h: number) => {
    const gx = cellOf(x)
    const gy = cellOf(y)
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const list = grid.get(keyOf(gx + dx, gy + dy))
        if (!list) continue
        for (const { b, card } of list) {
          const mx = card ? MARGIN : GAP_X
          const my = card ? MARGIN : GAP_Y
          if (Math.abs(x - b.x) < (w + b.w) / 2 + mx && Math.abs(y - b.y) < (h + b.h) / 2 + my) return false
        }
      }
    }
    return true
  }

  for (const card of fixed) occupy(card, true)

  /** Sunflower spiral: point i of the walk outward from a wanted spot. */
  const GOLDEN = Math.PI * (3 - Math.sqrt(5))
  const STEP = 7
  const STRETCH = 2.4
  /** Where the search for each wanted spot got to. */
  const reached = new Map<string, number>()

  for (const b of boxes) {
    const spot = `${Math.round(b.x)}:${Math.round(b.y)}`
    const ox = b.x
    const oy = b.y
    // Each step is cheap; this ceiling only guards against a bug looping forever.
    let i = Math.floor((reached.get(spot) ?? 0) * 0.85)
    for (; i < 2_000_000; i++) {
      const r = STEP * Math.sqrt(i)
      const x = ox + Math.cos(i * GOLDEN) * r * STRETCH
      const y = oy + Math.sin(i * GOLDEN) * r
      if (free(x, y, b.w, b.h)) {
        b.x = x
        b.y = y
        break
      }
    }
    reached.set(spot, i)
    occupy(b, false)
  }
}
