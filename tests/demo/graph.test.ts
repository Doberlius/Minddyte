import { describe, it, expect } from 'vitest'
import { emptyGraph, sendMessage, overlaps, nodeByKey } from '@/demo/graph'
import { RECORD_SEPARATOR } from '@/lib/compaction'

/**
 * The demo's in-memory mirror of `services/graph.ts#ingestUserMessage`.
 *
 * Every rule asserted here is a rule the real ingest already enforces against
 * SQL; these tests exist so the two cannot drift apart silently. Where a rule
 * has a spec section, the real implementation cites it — the citation is not
 * repeated here, only the behaviour.
 *
 * The message text is not invented: each sentence was run through the real
 * `extractConcepts` before being written down, so these assertions describe
 * the extractor that exists rather than the one we might wish for.
 */

const PG_A = 'We decided to use PostgreSQL because the data has a clear relational schema.'
const PG_B = 'Is PostgreSQL a good fit for storing a graph of concepts?'
const RUST = 'Rust has no garbage collector, so ownership decides when memory is freed.'

describe('sendMessage', () => {
  it('creates the chat on first message and derives its title', () => {
    const g = sendMessage(emptyGraph(), { chatId: 'c1', userText: PG_A })

    expect(g.chats).toHaveLength(1)
    expect(g.chats[0].id).toBe('c1')
    expect(g.chats[0].title).toBe('We decided to use PostgreSQL because the data has a clear')
  })

  it('turns auto concepts into nodes keyed by canonical key', () => {
    const g = sendMessage(emptyGraph(), { chatId: 'c1', userText: PG_A })

    expect(g.nodes.map((n) => n.key).sort()).toEqual(['postgresql', 'relationalschema'])
    expect(nodeByKey(g, 'postgresql')?.label).toBe('PostgreSQL')
  })

  it('never promotes a suggested (bare) concept to a node', () => {
    // "data" is bare — 29% measured precision — so it is suggested, never auto.
    const g = sendMessage(emptyGraph(), { chatId: 'c1', userText: PG_A })

    expect(g.nodes.map((n) => n.key)).not.toContain('data')
  })

  it('extracts from the user only, never from the assistant reply', () => {
    const g = sendMessage(emptyGraph(), {
      chatId: 'c1',
      userText: PG_A,
      assistantText: RUST,
    })

    expect(g.nodes.map((n) => n.key)).not.toContain('rust')
  })

  it('reuses one node across two chats that share a canonical key', () => {
    let g = sendMessage(emptyGraph(), { chatId: 'c1', userText: PG_A })
    g = sendMessage(g, { chatId: 'c2', userText: PG_B })

    const pg = nodeByKey(g, 'postgresql')
    expect(pg).toBeDefined()
    expect(pg!.chatIds).toEqual(['c1', 'c2'])
    expect(g.nodes.filter((n) => n.key === 'postgresql')).toHaveLength(1)
  })

  it('counts a chat once however often it repeats a concept', () => {
    let g = sendMessage(emptyGraph(), { chatId: 'c1', userText: PG_A })
    g = sendMessage(g, { chatId: 'c1', userText: PG_B })

    expect(nodeByKey(g, 'postgresql')!.chatIds).toEqual(['c1'])
  })

  it('keeps the first label seen when the same key arrives again', () => {
    let g = sendMessage(emptyGraph(), { chatId: 'c1', userText: PG_A })
    g = sendMessage(g, { chatId: 'c2', userText: PG_B })

    expect(nodeByKey(g, 'postgresql')!.label).toBe('PostgreSQL')
  })

  it('leaves the original graph untouched', () => {
    const before = sendMessage(emptyGraph(), { chatId: 'c1', userText: PG_A })
    const nodeCount = before.nodes.length
    sendMessage(before, { chatId: 'c2', userText: RUST })

    expect(before.nodes).toHaveLength(nodeCount)
    expect(before.chats).toHaveLength(1)
  })
})

describe('compaction', () => {
  it('records the user message verbatim', () => {
    const g = sendMessage(emptyGraph(), { chatId: 'c1', userText: PG_A })

    expect(g.chats[0].compaction).toBe(PG_A)
  })

  it('puts the user sentences ahead of the assistant reply', () => {
    const g = sendMessage(emptyGraph(), {
      chatId: 'c1',
      userText: PG_A,
      assistantText: RUST,
    })

    const parts = g.chats[0].compaction.split(RECORD_SEPARATOR)
    expect(parts[0]).toBe(PG_A)
    expect(parts[1]).toBe(RUST)
  })

  it('leads with the newest turn', () => {
    let g = sendMessage(emptyGraph(), { chatId: 'c1', userText: PG_A })
    g = sendMessage(g, { chatId: 'c1', userText: PG_B })

    expect(g.chats[0].compaction.split(RECORD_SEPARATOR)[0]).toBe(PG_B)
  })
})

describe('overlaps', () => {
  it('is empty while no key is shared', () => {
    let g = sendMessage(emptyGraph(), { chatId: 'c1', userText: PG_A })
    g = sendMessage(g, { chatId: 'c2', userText: RUST })

    expect(overlaps(g)).toEqual([])
  })

  it('pairs the two chats that hold the same node', () => {
    let g = sendMessage(emptyGraph(), { chatId: 'c1', userText: PG_A })
    g = sendMessage(g, { chatId: 'c2', userText: PG_B })

    expect(overlaps(g)).toEqual([{ a: 'c1', b: 'c2', keys: ['postgresql'] }])
  })

  it('reports one pair carrying every key the two chats share', () => {
    let g = sendMessage(emptyGraph(), { chatId: 'c1', userText: PG_A })
    g = sendMessage(g, { chatId: 'c2', userText: PG_A })

    expect(overlaps(g)).toHaveLength(1)
    expect(overlaps(g)[0].keys).toEqual(['postgresql', 'relationalschema'])
  })
})
