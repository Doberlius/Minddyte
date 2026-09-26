import { beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { getDb, forgotten, messageNodes, nodes, rejectedPhrases, sessionNodes, sessions } from '../../db'
import { FIXTURE_WORKSPACE_ID as WS, newChat, truncateAll } from '../helpers/pglite'
import { persistMessage } from '@/services/graph'
import { reextractNodes } from '@/services/reextract'
import { canonicalKey } from '@/lib/text'

beforeEach(truncateAll)

/** A message plus the links an OLD extractor wrote for it: `labels` as-is. */
async function oldIngest(chatId: string, content: string, labels: string[], headline?: string) {
  const db = await getDb()
  const messageId = await persistMessage({ workspaceId: WS, sessionId: chatId, role: 'user', content })
  for (const label of labels) {
    const key = canonicalKey(label)
    const [n] = await db
      .insert(nodes)
      .values({ workspaceId: WS, label, canonicalKey: key, chatCount: 1 })
      .onConflictDoUpdate({ target: [nodes.workspaceId, nodes.canonicalKey], set: { label } })
      .returning({ id: nodes.id })
    await db.insert(sessionNodes).values({ sessionId: chatId, nodeId: n.id }).onConflictDoNothing()
    await db.insert(messageNodes).values({ messageId, nodeId: n.id }).onConflictDoNothing()
    if (label === headline) await db.update(sessions).set({ headlineNodeId: n.id }).where(eq(sessions.id, chatId))
  }
}

async function run() {
  const db = await getDb()
  await db.transaction((tx) => reextractNodes(tx))
}

async function state(chatId: string) {
  const db = await getDb()
  const linked = await db
    .select({ key: nodes.canonicalKey, count: nodes.chatCount })
    .from(sessionNodes)
    .innerJoin(nodes, eq(nodes.id, sessionNodes.nodeId))
    .where(eq(sessionNodes.sessionId, chatId))
  const [chat] = await db.select({ h: sessions.headlineNodeId }).from(sessions).where(eq(sessions.id, chatId))
  const head = chat.h ? await db.query.nodes.findFirst({ where: eq(nodes.id, chat.h) }) : undefined
  return { linked: linked.sort((x, y) => x.key.localeCompare(y.key)), headline: head?.canonicalKey ?? null }
}

describe('reextractNodes', () => {
  it("replaces ticket 12's dead key with the concept the user meant", async () => {
    const a = await newChat()
    await oldIngest(a, 'Set max.poll.records carefully.', ['Set max.poll.records'], 'Set max.poll.records')

    await run()

    expect(await state(a)).toEqual({ linked: [{ key: 'maxpollrecords', count: 1 }], headline: 'maxpollrecords' })
    const db = await getDb()
    expect(await db.query.nodes.findFirst({ where: eq(nodes.canonicalKey, 'setmaxpollrecords') })).toBeUndefined()
  })

  it("splits ticket 11's comma-fused key into its concepts", async () => {
    const a = await newChat()
    await oldIngest(a, 'I use PostgreSQL, Redis, and Kafka for this project.', ['PostgreSQL, Redis', 'Kafka'], 'PostgreSQL, Redis')

    await run()

    expect((await state(a)).linked.map((l) => l.key)).toEqual(['kafka', 'postgresql', 'redis'])
    expect((await state(a)).headline).toBe('postgresql')
  })

  it('never brings back a concept forgotten in that chat', async () => {
    const a = await newChat()
    await oldIngest(a, 'We run Kafka and PostgreSQL in production.', ['PostgreSQL'], 'PostgreSQL')
    const db = await getDb()
    await db.insert(forgotten).values({ sessionId: a, nodeLabel: 'Kafka' })

    await run()

    expect((await state(a)).linked.map((l) => l.key)).toEqual(['postgresql'])
  })

  it('never adds a phrase the user rejected account-wide, and never removes an existing link for it', async () => {
    const a = await newChat()
    await oldIngest(a, 'Kafka again, with PostgreSQL.', ['Kafka'], 'Kafka')
    const b = await newChat()
    await oldIngest(b, 'We run Kafka and PostgreSQL in production.', ['Kafka', 'PostgreSQL'], 'Kafka')
    const db = await getDb()
    await db.insert(rejectedPhrases).values({ workspaceId: WS, phrase: 'PostgreSQL' })

    await run()

    expect((await state(a)).linked.map((l) => l.key)).toEqual(['kafka'])
    expect((await state(b)).linked.map((l) => l.key)).toEqual(['kafka', 'postgresql'])
  })

  it('recounts chat_count across chats', async () => {
    const a = await newChat()
    await oldIngest(a, 'Tell me about Kafka.', ['Kafka'], 'Kafka')
    const b = await newChat()
    await oldIngest(b, 'Tell me about Kafka.', ['Kafka'], 'Kafka') // count left at 1 by oldIngest

    await run()

    expect((await state(a)).linked).toEqual([{ key: 'kafka', count: 2 }])
  })

  it('leaves the time a concept was last referenced alone when its link was already right', async () => {
    const a = await newChat()
    await oldIngest(a, 'Tell me about Kafka.', ['Kafka'], 'Kafka')
    const db = await getDb()
    const before = (await db.query.nodes.findFirst({ where: eq(nodes.canonicalKey, 'kafka') }))!.lastReferencedAt

    await run()

    const after = (await db.query.nodes.findFirst({ where: eq(nodes.canonicalKey, 'kafka') }))!.lastReferencedAt
    expect(after.getTime()).toBe(before.getTime())
  })

  it('changes nothing on a second run', async () => {
    const a = await newChat()
    await oldIngest(a, 'Set max.poll.records carefully.', ['Set max.poll.records'], 'Set max.poll.records')
    await run()
    const once = await state(a)

    await run()

    expect(await state(a)).toEqual(once)
  })
})
