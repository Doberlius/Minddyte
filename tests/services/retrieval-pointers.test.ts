import { beforeEach, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { getDb } from '../../db'
import { strongPhrases } from '@/lib/tokens'
import { FIXTURE_WORKSPACE_ID, newChat, truncateAll } from '../helpers/pglite'
import { ingestUserMessage, persistMessage } from '@/services/graph'
import { retrieveContext } from '@/services/retrieval'

beforeEach(truncateAll)

/** One full turn, both roles indexed. Shared by every describe in this file. */
async function turn(chatId: string, user: string, assistant: string) {
  const workspaceId = FIXTURE_WORKSPACE_ID
  const messageId = await persistMessage({ workspaceId, sessionId: chatId, role: 'user', content: user })
  const assistantMessageId = await persistMessage({ workspaceId, sessionId: chatId, role: 'assistant', content: assistant, modelUsed: 'test' })
  await ingestUserMessage({ workspaceId, sessionId: chatId, messageId, content: user, assistantContent: assistant, assistantMessageId })
}

describe('retrieval reads memory from pointers', () => {
  // The failure ticket 11 measured: the fact lives deep in a long reply.
  it('reaches a fact from deep inside a long reply', async () => {
    const a = await newChat('A')
    const filler = Array.from({ length: 40 }, (_, i) => `Filler sentence number ${i} says little.`).join(' ')
    await turn(a, 'Tell me about Kafka partitions.', `${filler} Kafka partitions guarantee order only within one partition.`)
    const b = await newChat('B')
    const { chats } = await retrieveContext({
      workspaceId: FIXTURE_WORKSPACE_ID, sessionId: b, mode: 'explore', taggedChatIds: [],
      draftText: 'How do Kafka partitions guarantee order?',
    })
    expect(chats.map((c) => c.id)).toEqual([a])
    expect(chats[0].excerpts.join(' ')).toContain('guarantee order only within one partition')
  })

  // Whole-branch review, finding 6 (spec Q10): each chat's passages are scored
  // against the draft and the labels of the Nodes IT shares — not a label set
  // pooled from every reached chat, which would let chat C's concept pick
  // chat A's passages.
  it("scores a chat's passages by its own shared concepts, not another chat's", async () => {
    const a = await newChat('A')
    const filler = Array.from({ length: 12 }, (_, i) => `Filler sentence number ${i} says little.`).join(' ')
    await turn(a, 'Tell me about Kafka partitions.', `Kafka partitions keep order. ${filler} Redis caching belongs to another chat entirely.`)
    const c = await newChat('C')
    await turn(c, 'Tell me about Redis caching.', 'Redis caching keeps hot keys in memory.')
    const b = await newChat('B')
    await turn(b, 'How do Kafka partitions relate to Redis caching?', 'Sure.')
    const { chats } = await retrieveContext({
      workspaceId: FIXTURE_WORKSPACE_ID, sessionId: b, mode: 'explore', taggedChatIds: [], draftText: 'go on',
    })
    const found = chats.find((x) => x.id === a)!
    expect(found.why).toMatch(/Kafka partitions/i)
    expect(found.why).not.toMatch(/Redis caching/i)
    expect(found.excerpts.join(' ')).toContain('Kafka partitions keep order.')
    expect(found.excerpts.join(' ')).not.toContain('Redis caching belongs to another chat')
  })

  it('sends the text that follows an emoji verbatim', async () => {
    const a = await newChat('A')
    await turn(a, '🎉 Kafka partitions keep order. Redis caches sessions.', 'Noted.')
    const b = await newChat('B')
    const { chats } = await retrieveContext({
      workspaceId: FIXTURE_WORKSPACE_ID, sessionId: b, mode: 'focus', taggedChatIds: [a], draftText: 'what about Redis?',
    })
    expect(chats[0].excerpts.join('\n')).toContain('Redis caches sessions.')
  })

  // Review Focus 5.
  // Each assistant excerpt is ~3 passages x ~1,050 chars, so four chats need
  // ~12,600 chars against an 8,000 budget: at least one must lose a window.
  it('reports every tagged chat that did not fully fit, instead of shrinking it silently', async () => {
    const ids: string[] = []
    for (let i = 0; i < 4; i++) {
      const id = await newChat(`Big ${i}`)
      const long = Array.from({ length: 12 }, (_, j) => `Chat ${i} passage ${j} ${'detail '.repeat(150)}end.`).join(' ')
      await turn(id, `Long chat ${i}.`, long)
      ids.push(id)
    }
    const b = await newChat('B')
    const { chats, dropped } = await retrieveContext({
      workspaceId: FIXTURE_WORKSPACE_ID, sessionId: b, mode: 'focus', taggedChatIds: ids, draftText: 'summarise',
    })
    const used = chats.reduce((n, c) => n + c.excerpts.join('').length, 0)
    expect(used).toBeLessThanOrEqual(8000)
    expect(dropped.length).toBeGreaterThan(0)
    // Every chat is accounted for: fully sent, or named in `dropped`.
    const full = chats.filter((c) => !dropped.includes(c.title))
    expect(full.length + dropped.length).toBe(4)
  })
})

describe('reach by text', () => {
  // The case node overlap cannot reach: the fact is in the ASSISTANT reply,
  // extraction is user-only (§4.2), so no Node is attached to it.
  it('reaches a chat whose only relevant content is an assistant fact', async () => {
    const a = await newChat('Logs')
    await turn(a, 'What are the defaults?', 'The retention period for audit logs is ninety days by default.')
    const b = await newChat('B')
    const { chats } = await retrieveContext({
      workspaceId: FIXTURE_WORKSPACE_ID, sessionId: b, mode: 'explore', taggedChatIds: [],
      draftText: 'how long do we keep audit logs',
    })
    expect(chats.map((c) => c.id)).toContain(a)
  })

  it('promotes an exact multi-word phrase, and says so', async () => {
    const a = await newChat('Logs')
    await turn(a, 'Defaults?', 'The retention period for audit logs is ninety days by default.')
    const b = await newChat('B')
    const { chats } = await retrieveContext({
      workspaceId: FIXTURE_WORKSPACE_ID, sessionId: b, mode: 'explore', taggedChatIds: [],
      draftText: 'What is our retention period?',
    })
    expect(chats[0].id).toBe(a)
    expect(chats[0].why).toMatch(/matches exact phrase "retention period"/i)
  })

  // Fix round 1, finding 2: every other test in this file reaches through a
  // strong phrase, so 'text' — the plain, unpromoted tier — and its "matches
  // your wording" reason were never exercised. Measured against this exact
  // fixture: word_similarity('ninety days sounds about right', 'The
  // retention period for audit logs is ninety days by default.') = 0.387,
  // above PROVISIONAL.reachWordSimilarity (0.3); strongPhrases('ninety days
  // sounds about right') = [] (no phrase of >= 2 significant tokens), so
  // promotion never fires and the chat surfaces via the plain text tier.
  it('reaches a chat by wording alone, with no strong phrase to promote it', async () => {
    const a = await newChat('Logs')
    await turn(a, 'What are the defaults?', 'The retention period for audit logs is ninety days by default.')
    expect(strongPhrases('ninety days sounds about right')).toEqual([])
    const b = await newChat('B')
    const { chats } = await retrieveContext({
      workspaceId: FIXTURE_WORKSPACE_ID, sessionId: b, mode: 'explore', taggedChatIds: [],
      draftText: 'ninety days sounds about right',
    })
    expect(chats.map((c) => c.id)).toContain(a)
    const found = chats.find((c) => c.id === a)!
    expect(found.why).toMatch(/matches your wording/i)
  })

  it('does not reach by text in focus mode', async () => {
    const a = await newChat('Logs')
    await turn(a, 'Defaults?', 'The retention period for audit logs is ninety days by default.')
    const b = await newChat('B')
    const { chats } = await retrieveContext({
      workspaceId: FIXTURE_WORKSPACE_ID, sessionId: b, mode: 'focus', taggedChatIds: [], draftText: 'retention period',
    })
    expect(chats).toEqual([])
  })

  // Review Focus 3: a leaked GUC is permanent on single-connection PGlite.
  it('leaves the trigram thresholds at their defaults afterwards', async () => {
    const b = await newChat('B')
    await retrieveContext({
      workspaceId: FIXTURE_WORKSPACE_ID, sessionId: b, mode: 'explore', taggedChatIds: [], draftText: 'anything at all',
    })
    const db = await getDb()
    const res = await db.execute(sql`show pg_trgm.word_similarity_threshold`)
    const value = Object.values((res as unknown as { rows: Record<string, string>[] }).rows[0])[0]
    expect(value).toBe('0.6')
    const strictRes = await db.execute(sql`show pg_trgm.strict_word_similarity_threshold`)
    const strictValue = Object.values((strictRes as unknown as { rows: Record<string, string>[] }).rows[0])[0]
    expect(strictValue).toBe('0.5')
  })
})

// Whole-branch review, finding 1: pg_trgm rebuilds the draft's trigrams for
// every candidate row, and a long draft shares trigrams with nearly every
// passage, so the index narrows little and the cost grows with draft length.
// PGlite is one in-process connection: while this runs, every visitor waits.
// The chat route has seen a real 824,000-char paste.
describe('a very long draft', () => {
  const TOPICS = [
    'Kafka partitions keep order within one partition and consumers commit offsets after processing.',
    'Redis caches session tokens with a short expiry so a restart only logs people out.',
    'PostgreSQL vacuum reclaims dead tuples and the autovacuum daemon tunes itself by table size.',
    'The retention period for audit logs is ninety days unless the contract says otherwise.',
    'Password hashing uses argon2id with a memory cost chosen to take about half a second.',
    'The deploy pipeline builds a container, runs migrations, then shifts traffic gradually.',
    'Feature flags are evaluated on the server so the client never sees an unreleased path.',
    'Rate limiting counts requests per workspace in a sliding window of sixty seconds.',
  ]
  const WORDS = 'alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november oscar papa quebec romeo sierra tango uniform victor whiskey xray yankee zulu'.split(' ')

  function varied(seed: number, n: number): string {
    return Array.from({ length: n }, (_, i) => {
      const t = TOPICS[(seed + i) % TOPICS.length]
      return `${t} Note ${WORDS[(seed * 7 + i) % WORDS.length]} ${WORDS[(seed + i * 3) % WORDS.length]} ${seed}-${i}.`
    }).join(' ')
  }

  it('costs no more than a short one: the search reads a bounded prefix', async () => {
    for (let c = 0; c < 40; c++) {
      const id = await newChat(`Seed ${c}`)
      await turn(id, `Question ${c} about ${TOPICS[c % TOPICS.length].split(' ').slice(0, 3).join(' ')}?`, varied(c, 8))
    }
    const b = await newChat('B')
    let draft = ''
    for (let i = 0; draft.length < 50_000; i++) draft += varied(i + 100, 1) + ' '
    draft = draft.slice(0, 50_000)

    const started = performance.now()
    await retrieveContext({ workspaceId: FIXTURE_WORKSPACE_ID, sessionId: b, mode: 'explore', taggedChatIds: [], draftText: draft })
    // Measured at this scale: uncapped 9,944 ms; capped at 500 code points 450 ms.
    expect(performance.now() - started).toBeLessThan(1500)
  }, 120_000)
})
