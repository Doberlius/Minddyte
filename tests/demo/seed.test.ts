import { describe, it, expect } from 'vitest'
import { seededGraph, SEED_CHATS } from '@/demo/seed'
import { overlaps, nodeByKey } from '@/demo/graph'

/**
 * A guard on the demo's first frame.
 *
 * The seed conversations are worded to survive the real extractor, and that is
 * a fragile contract: a change to `lib/extract.ts` can silently reduce the
 * opening canvas to scattered dots with no edges, which is the one thing the
 * demo exists to disprove. These tests fail loudly instead.
 *
 * They assert the SHAPE the demo needs, not every node the extractor happens
 * to find, so ordinary extractor improvements stay free to add concepts.
 */

describe('the seeded graph', () => {
  const graph = seededGraph()

  it('opens with every seeded conversation present', () => {
    expect(graph.chats).toHaveLength(SEED_CHATS.length)
  })

  it('connects the chats that were written to connect', () => {
    expect(overlaps(graph).map((o) => `${o.a}<->${o.b}`).sort()).toEqual([
      'db<->deploy',
      'db<->infra',
      'infra<->deploy',
      'lang<->safety',
    ])
  })

  it('holds the five concepts the tour points at', () => {
    for (const key of ['postgresql', 'rust', 'garbagecollector', 'dockercompose', 'kubernetes']) {
      expect(nodeByKey(graph, key)?.chatIds.length, `${key} should be shared`).toBeGreaterThan(1)
    }
  })

  it('spreads PostgreSQL across three separate conversations', () => {
    // The canvas's centrepiece: one concept the user never filed, holding
    // three conversations together.
    expect(nodeByKey(graph, 'postgresql')!.chatIds).toEqual(['db', 'infra', 'deploy'])
  })

  it('leaves no conversation stranded', () => {
    const connected = new Set(overlaps(graph).flatMap((o) => [o.a, o.b]))
    expect([...connected].sort()).toEqual(SEED_CHATS.map((c) => c.id).sort())
  })

  it('names every chat from its own first message', () => {
    for (const chat of graph.chats) {
      expect(chat.title, `${chat.id} should have a derived title`).not.toBe('New Session')
      expect(chat.headlineKey, `${chat.id} should have a headline`).not.toBeNull()
    }
  })

  it('gives every chat a compaction holding both roles', () => {
    for (const chat of graph.chats) {
      const seed = SEED_CHATS.find((c) => c.id === chat.id)!
      const newest = seed.turns[seed.turns.length - 1]
      expect(chat.compaction, `${chat.id} should lead with its newest user sentence`).toContain(
        newest.user.split('.')[0],
      )
    }
  })
})
