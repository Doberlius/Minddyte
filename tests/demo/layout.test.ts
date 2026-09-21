import { describe, it, expect } from 'vitest'
import { layoutGraph } from '@/demo/layout'
import { emptyGraph, sendMessage } from '@/demo/graph'
import { seededGraph } from '@/demo/seed'

/**
 * The layout carries an argument, so it is worth asserting rather than eyeballing:
 * a concept several conversations share is pulled toward the middle, and the
 * same graph always draws the same picture.
 */

function distance(p: { x: number; y: number }) {
  return Math.hypot(p.x, p.y)
}

describe('layoutGraph', () => {
  const graph = seededGraph()
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

  it('keeps chats on the ring', () => {
    for (const chat of layout.chats) {
      expect(distance(chat)).toBeCloseTo(340, 5)
    }
  })

  it('leaves no two concept labels stacked on each other', () => {
    // The centroid rule alone piled five shared concepts into one unreadable
    // heap at the centre. Relaxation is what stops that, so it is asserted
    // rather than trusted.
    for (let i = 0; i < layout.concepts.length; i++) {
      for (let j = i + 1; j < layout.concepts.length; j++) {
        const a = layout.concepts[i]
        const b = layout.concepts[j]
        expect(
          Math.hypot(a.x - b.x, a.y - b.y),
          `${a.id} and ${b.id} overlap`,
        ).toBeGreaterThan(90)
      }
    }
  })

  it('keeps concepts clear of the chat cards', () => {
    for (const concept of layout.concepts) {
      for (const chat of layout.chats) {
        expect(
          Math.hypot(concept.x - chat.x, concept.y - chat.y),
          `${concept.id} sits on top of chat ${chat.id}`,
        ).toBeGreaterThan(150)
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
    const one = sendMessage(emptyGraph(), { chatId: 'solo', userText: '...' })
    const l = layoutGraph(one)

    expect(l.chats).toHaveLength(1)
    expect(Number.isFinite(l.chats[0].x)).toBe(true)
  })
})
