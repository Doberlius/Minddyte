import { beforeEach, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { getDb, nodes, sessions } from '../../db'
import { countRows, FIXTURE_WORKSPACE_ID, newChat, truncateAll } from '../helpers/pglite'
import { persistMessage, ingestUserMessage } from '@/services/graph'
import { RECORD_SEPARATOR } from '@/lib/compaction'

// Both sentences share this concept. Step 1 confirmed extractConcepts returns
// the label "Kafka partitions" in `auto` for BOTH fixture sentences below.
// The tests query nodes.canonicalKey, not the raw label, and canonicalKey()
// (src/lib/text.ts) lowercases and strips everything but [a-z0-9] — so the
// value stored is 'kafkapartitions', confirmed by running canonicalKey('Kafka
// partitions') directly rather than assumed.
const SHARED_LABEL = 'kafkapartitions'

const FIRST = 'Kafka partitions handle event ordering in distributed systems.'
const SECOND = 'How do Kafka partitions affect throughput?'

/** One full turn: persist the user message, then run the graph write path. */
async function turn(chatId: string, userText: string, assistantText: string) {
  const workspaceId = FIXTURE_WORKSPACE_ID
  const messageId = await persistMessage({
    workspaceId, sessionId: chatId, role: 'user', content: userText,
  })
  await persistMessage({
    workspaceId, sessionId: chatId, role: 'assistant', content: assistantText, modelUsed: 'test',
  })
  await ingestUserMessage({
    workspaceId, sessionId: chatId, messageId, content: userText, assistantContent: assistantText,
  })
}

beforeEach(truncateAll)

describe('the graph write path against a real database', () => {
  it('every query in the path executes at all', async () => {
    // Coverage item 1. The `= any(${array})` bug passed typecheck, lint, build
    // and eleven reviews because nothing ever ran these statements.
    const chatId = await newChat()
    await turn(chatId, FIRST, 'Partitions preserve order within a key.')

    expect(await countRows('messages')).toBe(2)
    expect(await countRows('nodes')).toBeGreaterThan(0)
    expect(await countRows('session_nodes')).toBeGreaterThan(0)
    expect(await countRows('message_nodes')).toBeGreaterThan(0)
  })

  it('upsert infers the narrowed canonical_key constraint instead of duplicating', async () => {
    // Coverage item 2. Ticket 03 narrowed nodes_canonical_unique to
    // (canonical_key) alone, so onConflictDoUpdate's target had to narrow with
    // it. Ticket 04 proved this once by hand; this makes it permanent.
    const chatA = await newChat()
    const chatB = await newChat()
    await turn(chatA, FIRST, 'Order is per partition.')
    const afterFirst = await countRows('nodes')

    await turn(chatB, FIRST, 'Same answer.')

    expect(await countRows('nodes')).toBe(afterFirst)
  })

  it('chat_count counts CHATS, not messages', async () => {
    // Coverage item 3. chat_count feeds rarity weighting in ranking. If it moved
    // on every message, a chatty conversation would look like a rare concept.
    const chatId = await newChat()
    await turn(chatId, FIRST, 'First reply.')
    await turn(chatId, SECOND, 'Second reply.')

    const db = await getDb()
    const [node] = await db.select().from(nodes).where(eq(nodes.canonicalKey, SHARED_LABEL))
    expect(node).toBeDefined()
    expect(node.chatCount).toBe(1)
  })

  it('chat_count reaches 2 when a second CHAT mentions the same concept', async () => {
    const chatA = await newChat()
    const chatB = await newChat()
    await turn(chatA, FIRST, 'First reply.')
    await turn(chatB, SECOND, 'Second reply.')

    const db = await getDb()
    const [node] = await db.select().from(nodes).where(eq(nodes.canonicalKey, SHARED_LABEL))
    expect(node.chatCount).toBe(2)
  })

  it('derives title and headline exactly once, from server state', async () => {
    // Coverage item 4. Spec §4.4. The failure is silent AND permanent: a
    // re-derived title overwrites one the user may have chosen.
    const chatId = await newChat()
    await turn(chatId, FIRST, 'First reply.')

    const db = await getDb()
    const [afterFirst] = await db.select().from(sessions).where(eq(sessions.id, chatId))
    expect(afterFirst.title).not.toBe('New Session')
    expect(afterFirst.headlineNodeId).not.toBeNull()

    await turn(chatId, SECOND, 'Second reply.')

    const [afterSecond] = await db.select().from(sessions).where(eq(sessions.id, chatId))
    expect(afterSecond.title).toBe(afterFirst.title)
    expect(afterSecond.headlineNodeId).toBe(afterFirst.headlineNodeId)
  })

  it('a headline that is also an auto concept does not double-count', async () => {
    // The specific case ticket 06 called out: one label arriving twice in a
    // single transaction, once as an extracted concept and once as the derived
    // Headline. upsertNodeAndLink bumps chat_count only when the LINK is new,
    // so the second arrival must change nothing.
    const chatId = await newChat()
    await turn(chatId, FIRST, 'Reply.')

    const db = await getDb()
    const rows = await db.select().from(nodes)
    for (const n of rows) {
      expect(n.chatCount).toBe(1)
    }
  })

  it('stores the compaction verbatim, separator surviving a real column', async () => {
    // Coverage item 6. Both roles go in (spec §4.1) with the user's sentences
    // in front, where they survive trimming longest.
    const chatId = await newChat()
    await turn(chatId, FIRST, 'Partitions preserve order within a key.')

    const db = await getDb()
    const [chat] = await db.select().from(sessions).where(eq(sessions.id, chatId))

    expect(chat.compaction).toContain(RECORD_SEPARATOR)
    const records = chat.compaction.split(RECORD_SEPARATOR)
    expect(records.length).toBeGreaterThanOrEqual(2)
    expect(chat.compaction).toContain('Kafka partitions')
    expect(chat.compaction).toContain('Partitions preserve order')
    expect(chat.compactionUpdatedAt).not.toBeNull()
  })

  it('a label with no alphanumeric characters never becomes a Node', async () => {
    // '...' alone does NOT reach the guard this test means to check: its
    // extractConcepts().auto is empty, so the only node the write path
    // creates comes from the title-fallback headline ("New Session"), whose
    // canonical key is never empty — the assertion would pass even with the
    // guard deleted. '!!! ??? ...' does reach it: classifyShape() sees the
    // whitespace and calls it 'multi', and a 'multi' label is auto-created
    // rather than merely suggested (spec's admission gate), so this
    // punctuation-only phrase is fed straight into upsertNodeAndLink. Its
    // canonicalKey() strips every character, leaving ''. That is the one
    // input that actually forces upsertNodeAndLink's `if (!key) return null`
    // guard to run and skip the insert.
    const chatId = await newChat()
    await turn(chatId, '!!! ??? ...', '...')
    // Whatever else happens, nothing with an empty canonical key may be stored.
    const db = await getDb()
    const rows = await db.select().from(nodes)
    for (const n of rows) {
      expect(n.canonicalKey.length).toBeGreaterThan(0)
    }
  })
})

describe('the silent-loss guard (ticket 11, decision 3)', () => {
  async function ingestOnly(chatId: string, content: string) {
    const workspaceId = FIXTURE_WORKSPACE_ID
    const messageId = await persistMessage({ workspaceId, sessionId: chatId, role: 'user', content })
    return ingestUserMessage({ workspaceId, sessionId: chatId, messageId, content })
  }

  it('reports a message whose only sentence is too long to remember', async () => {
    const chatId = await newChat()
    // One dense 610-character sentence — the exact case that used to leave
    // memory empty with no log and no sign.
    const dense = 'Kafka ' + 'partitions preserve order within a single partition only '.repeat(10) + 'end.'
    expect(dense.length).toBeGreaterThan(500)
    expect(await ingestOnly(chatId, dense)).toEqual({ notRemembered: 'over-cap', skipped: [] })
  })

  it('reports nothing for a message that reached memory', async () => {
    const chatId = await newChat()
    expect(await ingestOnly(chatId, FIRST)).toEqual({ notRemembered: null, skipped: [] })
  })
})

describe('pointers (ticket 05)', () => {
  async function fullTurn(chatId: string, user: string, assistant: string) {
    const workspaceId = FIXTURE_WORKSPACE_ID
    const messageId = await persistMessage({ workspaceId, sessionId: chatId, role: 'user', content: user })
    const assistantMessageId = await persistMessage({
      workspaceId, sessionId: chatId, role: 'assistant', content: assistant, modelUsed: 'test',
    })
    return ingestUserMessage({
      workspaceId, sessionId: chatId, messageId, content: user,
      assistantContent: assistant, assistantMessageId,
    })
  }

  it('writes one pointer per sentence for BOTH roles', async () => {
    const chatId = await newChat()
    await fullTurn(chatId, 'How do partitions work?', 'Partitions keep order. Consumers scale by group.')
    expect(await countRows('chat_pointers')).toBe(3)
  })

  it('reads back the exact text by offset, through a real column', async () => {
    const chatId = await newChat()
    await fullTurn(chatId, '🎉 Kafka keeps order. Redis caches sessions.', 'Noted.')
    const db = await getDb()
    const rows = await db.execute(sql`
      select substring(m.content from p.start_char + 1 for p.end_char - p.start_char) as t
        from chat_pointers p join messages m on m.id = p.message_id
       order by m.created_at, p.ordinal`)
    const texts = (rows as unknown as { rows: { t: string }[] }).rows.map((r) => r.t)
    expect(texts).toContain('Redis caches sessions.')
  })

  it('is idempotent — ingesting the same message twice adds nothing', async () => {
    const chatId = await newChat()
    const workspaceId = FIXTURE_WORKSPACE_ID
    const messageId = await persistMessage({ workspaceId, sessionId: chatId, role: 'user', content: 'One. Two.' })
    await ingestUserMessage({ workspaceId, sessionId: chatId, messageId, content: 'One. Two.' })
    await ingestUserMessage({ workspaceId, sessionId: chatId, messageId, content: 'One. Two.' })
    expect(await countRows('chat_pointers')).toBe(2)
  })

  it('reports a code block too large to index, and still indexes the rest', async () => {
    const chatId = await newChat()
    const big = '```\n' + 'x'.repeat(4100) + '\n```'
    const out = await fullTurn(chatId, 'Here is my config.', `Look at this.\n\n${big}`)
    expect(out.skipped).toEqual([expect.objectContaining({ kind: 'code', length: big.length })])
    expect(await countRows('chat_pointers')).toBe(2)
  })

  // Known limit, stated rather than hidden: no capital letters means no
  // sentence boundaries, and pg_trgm cannot trigram Thai. It must still be
  // stored, whole, without error.
  it('stores a Thai message as one pointer without error', async () => {
    const chatId = await newChat()
    await fullTurn(chatId, 'สวัสดีครับ วันนี้อากาศดีมาก เราไปเที่ยวกันไหม', 'ได้เลย')
    expect(await countRows('chat_pointers')).toBe(2)
  })
})
