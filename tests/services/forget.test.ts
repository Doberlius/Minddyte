import { beforeEach, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { getDb, nodes, sessions, sessionNodes, forgotten } from '../../db'
import { countRows, truncateAll } from '../helpers/pglite'
import { createChat } from '@/services/dbApi'
import { ingestUserMessage, persistMessage } from '@/services/graph'
import { forgetConcept, forgetPreview } from '@/services/forget'
import { newWorkspaceId } from '@/lib/workspace'

beforeEach(truncateAll)

const WS = newWorkspaceId()

/** One real turn through the real ingest path; the assistant reply is optional. */
async function say(sessionId: string, user: string, assistant?: string) {
  const messageId = await persistMessage({ workspaceId: WS, sessionId, role: 'user', content: user })
  const assistantMessageId = assistant
    ? await persistMessage({ workspaceId: WS, sessionId, role: 'assistant', content: assistant, modelUsed: 'test' })
    : undefined
  await ingestUserMessage({ workspaceId: WS, sessionId, messageId, content: user, assistantContent: assistant, assistantMessageId })
}

async function keysOf(sessionId: string): Promise<string[]> {
  const db = await getDb()
  const rows = await db
    .select({ key: nodes.canonicalKey })
    .from(sessionNodes)
    .innerJoin(nodes, eq(nodes.id, sessionNodes.nodeId))
    .where(eq(sessionNodes.sessionId, sessionId))
  return rows.map((r) => r.key).sort()
}

async function node(key: string) {
  const db = await getDb()
  return db.query.nodes.findFirst({ where: and(eq(nodes.canonicalKey, key), eq(nodes.workspaceId, WS)) })
}

async function headlineKey(sessionId: string): Promise<string | null> {
  const db = await getDb()
  const [chat] = await db.select({ id: sessions.headlineNodeId }).from(sessions).where(eq(sessions.id, sessionId))
  if (!chat?.id) return null
  const n = await db.query.nodes.findFirst({ where: eq(nodes.id, chat.id) })
  return n?.canonicalKey ?? null
}

describe('forgetConcept', () => {
  it('unlinks the concept from that chat only, and recounts a shared one', async () => {
    const a = (await createChat(WS)).id
    const b = (await createChat(WS)).id
    await say(a, 'We run Kafka and PostgreSQL in production.')
    await say(b, 'Tell me about Kafka.')
    expect((await node('kafka'))?.chatCount).toBe(2)

    expect(await forgetConcept(WS, a, 'kafka')).toBe(true)

    expect(await keysOf(a)).toEqual(['postgresql'])
    expect(await keysOf(b)).toEqual(['kafka'])
    expect((await node('kafka'))?.chatCount).toBe(1)
  })

  it('deletes a concept no chat holds any more', async () => {
    const a = (await createChat(WS)).id
    await say(a, 'We run Kafka and PostgreSQL in production.')

    await forgetConcept(WS, a, 'kafka')

    expect(await node('kafka')).toBeUndefined()
    expect((await node('postgresql'))?.chatCount).toBe(1)
  })

  it('records the forgotten label for that chat, and keeps every message', async () => {
    const a = (await createChat(WS)).id
    await say(a, 'We run Kafka and PostgreSQL in production.', 'Kafka carries the events.')
    expect(await countRows('messages')).toBe(2)

    await forgetConcept(WS, a, 'kafka')

    const db = await getDb()
    expect(await db.select({ label: forgotten.nodeLabel }).from(forgotten).where(eq(forgotten.sessionId, a))).toEqual([
      { label: 'Kafka' },
    ])
    expect(await countRows('messages')).toBe(2)
  })

  it('moves the headline to the next concept from the first message', async () => {
    const a = (await createChat(WS)).id
    await say(a, 'We run Kafka and PostgreSQL in production.')
    expect(await headlineKey(a)).toBe('kafka')

    await forgetConcept(WS, a, 'kafka')

    expect(await headlineKey(a)).toBe('postgresql')
  })

  // Review Focus 1.
  it('clears the headline when no concept is left', async () => {
    const a = (await createChat(WS)).id
    await say(a, 'Tell me about Kafka.')

    await forgetConcept(WS, a, 'kafka')

    expect(await headlineKey(a)).toBeNull()
  })

  // Review Focus 3.
  it('a second forget of the same concept is "not found" and changes nothing', async () => {
    const a = (await createChat(WS)).id
    await say(a, 'We run Kafka and PostgreSQL in production.')
    await forgetConcept(WS, a, 'kafka')

    expect(await forgetConcept(WS, a, 'kafka')).toBe(false)
    expect(await countRows('forgotten')).toBe(1)
    expect(await keysOf(a)).toEqual(['postgresql'])
  })

  // Review Focus 4.
  it("another workspace's chat is 'not found', and nothing changes", async () => {
    const a = (await createChat(WS)).id
    await say(a, 'We run Kafka and PostgreSQL in production.')

    expect(await forgetConcept(newWorkspaceId(), a, 'kafka')).toBe(false)
    expect(await forgetPreview(newWorkspaceId(), a, 'kafka')).toBeNull()
    expect(await keysOf(a)).toEqual(['kafka', 'postgresql'])
    expect(await countRows('forgotten')).toBe(0)
  })
})

describe('forgetPreview', () => {
  it('lists the sentences of BOTH roles that mention the concept, whole words only', async () => {
    const a = (await createChat(WS)).id
    await say(
      a,
      'We run Kafka and PostgreSQL in production.',
      "PostgreSQL handles the writes. KAFKA's partitions carry the events. The Kafkaesque process is slow.",
    )

    const p = await forgetPreview(WS, a, 'kafka')

    expect(p).toEqual({
      label: 'Kafka',
      total: 2,
      sentences: ['We run Kafka and PostgreSQL in production.', "KAFKA's partitions carry the events."],
      otherChats: 0,
    })
  })

  // Review Focus 2: dots are not wildcards, and a label with punctuation still matches.
  it('matches a dotted label literally', async () => {
    const a = (await createChat(WS)).id
    await say(a, 'Set max.poll.records carefully.', 'Raise max.poll.records slowly. Keep maxXpollXrecords out of it.')

    const p = await forgetPreview(WS, a, 'maxpollrecords')

    expect(p?.sentences).toEqual(['Set max.poll.records carefully.', 'Raise max.poll.records slowly.'])
  })

  it('counts the other chats that keep the concept', async () => {
    const a = (await createChat(WS)).id
    const b = (await createChat(WS)).id
    await say(a, 'We run Kafka and PostgreSQL in production.')
    await say(b, 'Tell me about Kafka.')

    expect((await forgetPreview(WS, a, 'kafka'))?.otherChats).toBe(1)
  })

  it('is null for a concept the chat does not hold', async () => {
    const a = (await createChat(WS)).id
    await say(a, 'We run Kafka and PostgreSQL in production.')
    expect(await forgetPreview(WS, a, 'redis')).toBeNull()
  })
})
