import { describe, it, expect } from 'vitest'
import { layoutGraph, conceptWidth, CONCEPT_HEIGHT, CARD_SIZE } from '@/lib/graph-layout'
import fixtures from '../fixtures/view-graphs.json'
import type { ViewGraph } from '@/types/graph'

const seeded = fixtures.seeded as unknown as ViewGraph
const solo = fixtures.solo as unknown as ViewGraph
const grown = fixtures.grown as unknown as ViewGraph

/**
 * The layout carries an argument, so it is worth asserting rather than eyeballing:
 * a concept several conversations share is pulled toward the middle, and the
 * same graph always draws the same picture.
 */

function distance(p: { x: number; y: number }) {
  return Math.hypot(p.x, p.y)
}

describe('layoutGraph', () => {
  // The layout reads the view shape now, which is what both the app and
  // the demo hand it.
  const graph = seeded
  const layout = layoutGraph(graph)

  it('places every chat and every concept', () => {
    expect(layout.chats).toHaveLength(graph.chats.length)
    expect(layout.concepts).toHaveLength(graph.nodes.length)
  })

  it('is stable across calls', () => {
    expect(layoutGraph(graph)).toEqual(layoutGraph(graph))
  })

  it('never emits NaN', () => {
    for (const p of [...layout.chats, ...layout.concepts]) {
      expect(Number.isFinite(p.x), `${p.id}.x`).toBe(true)
      expect(Number.isFinite(p.y), `${p.id}.y`).toBe(true)
    }
  })

  it('pulls a widely shared concept closer to the centre than a lone one', () => {
    const shared = layout.concepts.find((c) => c.id === 'postgresql')!
    const lone = layout.concepts.find((c) => c.id === 'relationalschema')!

    expect(distance(shared)).toBeLessThan(distance(lone))
  })

  it('keeps chats on the ring, which is an ellipse wider than it is tall', () => {
    // A circular ring fits a landscape window by height and wastes both sides.
    for (const chat of layout.chats) {
      const rx = 330 * 1.3
      const ry = 330 * 0.94
      expect((chat.x / rx) ** 2 + (chat.y / ry) ** 2).toBeCloseTo(1, 5)
    }

    const widest = Math.max(...layout.chats.map((c) => Math.abs(c.x)))
    const tallest = Math.max(...layout.chats.map((c) => Math.abs(c.y)))
    expect(widest).toBeGreaterThan(tallest)
  })

  it('leaves no two concept labels overlapping', () => {
    // Centre-to-centre distance is the wrong test and was the wrong rule:
    // "Docker Compose" and "Rust" cleared a 118px centre gap and still
    // rendered on top of each other, because their half-widths sum past it.
    const boxes = layout.concepts.map((c) => {
      const node = graph.nodes.find((n) => n.key === c.id)!
      return { ...c, w: conceptWidth(node.label, node.chatIds.length > 1), h: CONCEPT_HEIGHT }
    })

    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]
        const b = boxes[j]
        const apart =
          Math.abs(a.x - b.x) >= (a.w + b.w) / 2 || Math.abs(a.y - b.y) >= (a.h + b.h) / 2
        expect(apart, `${a.id} overlaps ${b.id}`).toBe(true)
      }
    }
  })

  it('keeps concepts clear of the chat cards', () => {
    for (const concept of layout.concepts) {
      const node = graph.nodes.find((n) => n.key === concept.id)!
      const w = conceptWidth(node.label, node.chatIds.length > 1)
      for (const chat of layout.chats) {
        const apart =
          Math.abs(concept.x - chat.x) >= (w + CARD_SIZE.w) / 2 ||
          Math.abs(concept.y - chat.y) >= (CONCEPT_HEIGHT + CARD_SIZE.h) / 2
        expect(apart, `${concept.id} sits on top of chat ${chat.id}`).toBe(true)
      }
    }
  })

  it('separates two concepts belonging to the same single chat', () => {
    const [a, b] = layout.concepts.filter((c) =>
      ['relationalschema', 'goodfit'].includes(c.id),
    )
    expect(distance({ x: a.x - b.x, y: a.y - b.y })).toBeGreaterThan(0)
  })

  it('survives a graph with one chat and no concepts', () => {
    const l = layoutGraph(solo)

    expect(l.chats).toHaveLength(1)
    expect(Number.isFinite(l.chats[0].x)).toBe(true)
  })

  it('still has no overlaps once a visitor adds their own conversation', () => {
    // The pile that prompted the box rule appeared at SIX chats, not the
    // seeded five — the ring re-spaces itself on every arrival, so the seeded
    // layout passing proves nothing about the one a visitor actually sees.
    const l = layoutGraph(grown)

    const boxes = l.concepts.map((c) => {
      const node = grown.nodes.find((n) => n.key === c.id)!
      return { ...c, w: conceptWidth(node.label, node.chatIds.length > 1), h: CONCEPT_HEIGHT }
    })

    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]
        const b = boxes[j]
        const apart =
          Math.abs(a.x - b.x) >= (a.w + b.w) / 2 || Math.abs(a.y - b.y) >= (a.h + b.h) / 2
        expect(apart, `${a.id} overlaps ${b.id}`).toBe(true)
      }
    }

    for (const concept of boxes) {
      for (const chat of l.chats) {
        const apart =
          Math.abs(concept.x - chat.x) >= (concept.w + CARD_SIZE.w) / 2 ||
          Math.abs(concept.y - chat.y) >= (concept.h + CARD_SIZE.h) / 2
        expect(apart, `${concept.id} sits on chat ${chat.id}`).toBe(true)
      }
    }
  })
})
