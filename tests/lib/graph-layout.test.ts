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

  it('keeps labels wider than any fixed grid cell apart', () => {
    // Placement only checks boxes in neighbouring grid cells. With a fixed
    // 260px cell, two 600px labels could clash while three cells apart and
    // never be compared, so the cell grows with the widest box. These four
    // want the same spot.
    const chats = ['a', 'b'].map((id) => ({ id, title: id, messageCount: 1, passageCount: 1, titleTruncated: false }))
    const nodes = [1, 2, 3, 4].map((i) => ({ key: `w${i}`, label: 'x'.repeat(60) + i, chatIds: ['a', 'b'] }))
    const l = layoutGraph({ chats, nodes }, { widthOf: () => 600 })
    for (let i = 0; i < l.concepts.length; i++) {
      for (let j = i + 1; j < l.concepts.length; j++) {
        const p = l.concepts[i]
        const q = l.concepts[j]
        expect(Math.abs(p.x - q.x) >= 600 || Math.abs(p.y - q.y) >= CONCEPT_HEIGHT, `${p.id} / ${q.id}`).toBe(true)
      }
    }
  })

  it('untangles a dense cluster of one chat’s own concepts', () => {
    // A pasted reading list: two dozen concepts around one chat. Sixty fixed
    // passes left nine pairs on top of each other; relaxing until nothing
    // moves leaves none. They are what zooming in shows, so they must read.
    const words = [
      'Designing Data-Intensive Applications', 'Raft', 'Paxos', 'vector clocks', 'CRDTs',
      'LSM trees', 'B-trees', 'Bloom filters', 'SSTables', 'compaction', 'replication lag',
      'leader election', 'quorum reads', 'sloppy quorums', 'hinted handoff', 'gossip protocols',
      'Merkle trees', 'two-phase commit', 'sagas', 'idempotency keys', 'exactly-once delivery',
      'Lamport timestamps', 'linearizability', 'Rust ownership',
    ]
    const chats = Array.from({ length: 9 }, (_, i) => ({
      id: `c${i}`, title: `c${i}`, messageCount: 4, passageCount: 4, titleTruncated: false,
    }))
    const nodes = [
      ...words.map((w, i) => ({ key: `w${i}`, label: w, chatIds: ['c0'] })),
      ...Array.from({ length: 40 }, (_, i) => ({ key: `o${i}`, label: `topic number ${i}`, chatIds: [`c${1 + (i % 8)}`] })),
      { key: 's1', label: 'PostgreSQL', chatIds: ['c0', 'c1', 'c2', 'c3'] },
    ]
    const g: ViewGraph = { chats, nodes }
    const boxes = layoutGraph(g).concepts.map((c) => {
      const n = nodes.find((x) => x.key === c.id)!
      return { ...c, w: conceptWidth(n.label, n.chatIds.length > 1) }
    })
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]
        const b = boxes[j]
        const apart = Math.abs(a.x - b.x) >= (a.w + b.w) / 2 || Math.abs(a.y - b.y) >= CONCEPT_HEIGHT
        expect(apart, `${a.id} overlaps ${b.id}`).toBe(true)
      }
    }
  })

  it('keeps hundreds of concepts shared by the same chats apart, and off every card', () => {
    // The real case that broke the old layout: one article pasted into three
    // chats, so 300 concepts all want the very same spot, the centre of those
    // three cards. Pushing pairs apart a fixed number of times never
    // untangled that pile; placing each into a free spot does.
    const chats = Array.from({ length: 28 }, (_, i) => ({
      id: `c${i}`, title: `c${i}`, messageCount: 2, passageCount: 2, titleTruncated: false,
    }))
    const words = ['Enigma', 'Max Newman', 'John Vincent Atanasoff', 'mechanical relays', 'leap years',
      'German cipher', 'initial delay', 'whole machine', 'processing element', 'Replica']
    const nodes = [
      ...Array.from({ length: 300 }, (_, i) => ({
        key: `a${i}`, label: `${words[i % words.length]} ${i}`, chatIds: ['c0', 'c1', 'c2'],
      })),
      ...Array.from({ length: 60 }, (_, i) => ({
        key: `p${i}`, label: `pair topic ${i}`, chatIds: [`c${3 + (i % 25)}`, `c${3 + ((i + 7) % 25)}`],
      })),
    ]
    const g: ViewGraph = { chats, nodes }
    const l = layoutGraph(g)

    const boxes = l.concepts.map((c) => {
      const n = nodes.find((x) => x.key === c.id)!
      return { ...c, w: conceptWidth(n.label, true) }
    })
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]
        const b = boxes[j]
        const apart = Math.abs(a.x - b.x) >= (a.w + b.w) / 2 || Math.abs(a.y - b.y) >= CONCEPT_HEIGHT
        expect(apart, `${a.id} overlaps ${b.id}`).toBe(true)
      }
      for (const chat of l.chats) {
        const a = boxes[i]
        const apart =
          Math.abs(a.x - chat.x) >= (a.w + CARD_SIZE.w) / 2 || Math.abs(a.y - chat.y) >= (CONCEPT_HEIGHT + CARD_SIZE.h) / 2
        expect(apart, `${a.id} sits on chat ${chat.id}`).toBe(true)
      }
    }
    // 28 cards on a ring sized for five: the cards themselves overlapped.
    for (let i = 0; i < l.chats.length; i++) {
      for (let j = i + 1; j < l.chats.length; j++) {
        const a = l.chats[i]
        const b = l.chats[j]
        const apart = Math.abs(a.x - b.x) >= CARD_SIZE.w || Math.abs(a.y - b.y) >= CARD_SIZE.h
        expect(apart, `chat ${a.id} overlaps chat ${b.id}`).toBe(true)
      }
    }
  })

  it('lays out a library-sized graph quickly and deterministically', () => {
    // 120 chats and 3,000 concepts: the all-pairs version took 4.5 million
    // comparisons a pass here. The grid makes it near-linear.
    const chats = Array.from({ length: 120 }, (_, i) => ({
      id: `c${i}`,
      title: `Chat ${i}`,
      messageCount: 3,
      passageCount: 3,
      titleTruncated: false,
    }))
    const nodes = Array.from({ length: 3000 }, (_, i) => ({
      key: `t${i}`,
      label: `topic ${i}`,
      chatIds: i % 7 === 0 ? [`c${i % 120}`, `c${(i * 13) % 120}`] : [`c${i % 120}`],
    }))
    const big: ViewGraph = { chats, nodes }

    const t0 = performance.now()
    const a = layoutGraph(big)
    const ms = performance.now() - t0

    expect(a.concepts).toHaveLength(3000)
    for (const p of a.concepts) expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true)
    expect(layoutGraph(big)).toEqual(a)
    // Generous, so a slow CI box does not fail it; the old loop needed tens of seconds.
    expect(ms).toBeLessThan(3000)
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
