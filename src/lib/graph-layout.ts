import type { DemoGraph } from './graph'

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
export type Layout = { chats: Placed[]; concepts: Placed[] }

const RING_RADIUS = 340
/** How far past its chat a single-chat concept floats. */
const ORBIT = 1.42
/** Bounded offset that keeps sibling concepts off each other, stable per key. */
const JITTER = 58
/** Clear space demanded between two concept pills. */
const CONCEPT_GAP = 104
/** Clear space demanded between a concept and a chat card. */
const CHAT_GAP = 168
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

export function layoutGraph(graph: DemoGraph, radius = RING_RADIUS): Layout {
  const n = Math.max(graph.chats.length, 1)

  const chatAt = new Map<string, Placed>()
  graph.chats.forEach((chat, i) => {
    // Start at the top and go clockwise, so the first seeded chat is where the
    // eye lands rather than off to the right.
    const angle = (2 * Math.PI * i) / n - Math.PI / 2
    chatAt.set(chat.id, {
      id: chat.id,
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
    })
  })

  const concepts: Placed[] = graph.nodes.map((node) => {
    const held = node.chatIds.map((id) => chatAt.get(id)).filter((p): p is Placed => !!p)

    // A concept whose chats have all been removed would otherwise divide by
    // zero; park it at the origin rather than produce NaN and blank the canvas.
    if (held.length === 0) {
      return { id: node.key, x: jitter(node.key, 0), y: jitter(node.key, 1) }
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
    }
  })

  return { chats: [...chatAt.values()], concepts: relax(concepts, [...chatAt.values()]) }
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
 * for two nodes at the same point comes from the key hash rather than a random
 * direction. The same graph still draws the same picture.
 */
function relax(concepts: Placed[], chats: Placed[]): Placed[] {
  const out = concepts.map((p) => ({ ...p }))

  for (let pass = 0; pass < RELAX_PASSES; pass++) {
    for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        separate(out[i], out[j], CONCEPT_GAP, true)
      }
    }
    // Chats hold the ring; only the concept yields.
    for (const concept of out) {
      for (const chat of chats) separate(concept, chat, CHAT_GAP, false)
    }
  }

  return out
}

/**
 * Move `a` (and `b`, when `b` may yield) just far enough apart to clear `gap`.
 * Two nodes at exactly the same point have no direction to separate along, so
 * one is taken from the key hash — stable, and never zero.
 */
function separate(a: Placed, b: Placed, gap: number, bYields: boolean): void {
  let dx = a.x - b.x
  let dy = a.y - b.y
  let d = Math.hypot(dx, dy)

  if (d >= gap) return

  if (d < 0.001) {
    const angle = (hash(a.id) % 360) * (Math.PI / 180)
    dx = Math.cos(angle)
    dy = Math.sin(angle)
    d = 1
  }

  const push = (gap - d) / d / (bYields ? 2 : 1)
  a.x += dx * push
  a.y += dy * push
  if (bYields) {
    b.x -= dx * push
    b.y -= dy * push
  }
}
