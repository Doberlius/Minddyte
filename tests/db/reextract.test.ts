import { beforeEach, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { getDb, forgotten, messageNodes, messages, nodes, rejectedPhrases, sessionNodes, sessions } from '../../db'
import { FIXTURE_WORKSPACE_ID as WS, newChat, truncateAll } from '../helpers/pglite'
import { persistMessage } from '@/services/graph'
import { createChat } from '@/services/dbApi'
import { newWorkspaceId } from '@/lib/workspace'
import { reextractNodes } from '@/services/reextract'
import { canonicalKey } from '@/lib/text'

beforeEach(truncateAll)

/**
 * A message plus the links an OLD extractor wrote for it: `labels` as-is.
 * By default a user message in the fixture workspace.
 */
async function oldIngest(
  chatId: string,
  content: string,
  labels: string[],
  headline?: string,
  { workspaceId = WS, role = 'user' }: { workspaceId?: string; role?: 'user' | 'assistant' } = {},
) {
  const db = await getDb()
  const messageId = await persistMessage({ workspaceId, sessionId: chatId, role, content })
  for (const label of labels) {
    const key = canonicalKey(label)
    const [n] = await db
      .insert(nodes)
      .values({ workspaceId, label, canonicalKey: key, chatCount: 1 })
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

/** The concept keys each of this chat's messages is linked to, from message_nodes. */
async function messageKeys(chatId: string) {
  const db = await getDb()
  const rows = await db
    .select({ key: nodes.canonicalKey })
    .from(messageNodes)
    .innerJoin(messages, eq(messages.id, messageNodes.messageId))
    .innerJoin(nodes, eq(nodes.id, messageNodes.nodeId))
    .where(eq(messages.sessionId, chatId))
  return rows.map((r) => r.key).sort()
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

  // Final review, fix 2: the riskiest paths of migration 0003.
  it('repairs a dead key that two chats share', async () => {
    const a = await newChat()
    await oldIngest(a, 'Set max.poll.records carefully.', ['Set max.poll.records'], 'Set max.poll.records')
    const b = await newChat()
    await oldIngest(b, 'Set max.poll.records carefully.', ['Set max.poll.records'], 'Set max.poll.records') // count left at 1

    await run()

    expect(await state(a)).toEqual({ linked: [{ key: 'maxpollrecords', count: 2 }], headline: 'maxpollrecords' })
    expect(await state(b)).toEqual({ linked: [{ key: 'maxpollrecords', count: 2 }], headline: 'maxpollrecords' })
    const db = await getDb()
    expect(await db.query.nodes.findFirst({ where: eq(nodes.canonicalKey, 'setmaxpollrecords') })).toBeUndefined()
    expect(await messageKeys(a)).toEqual(['maxpollrecords'])
    expect(await messageKeys(b)).toEqual(['maxpollrecords'])
    const orphans = await db.execute(
      sql`select count(*)::int as n from ${messageNodes} mn where not exists (select 1 from ${nodes} n where n.id = mn.node_id)`,
    )
    expect((orphans as unknown as { rows: { n: number }[] }).rows[0].n).toBe(0)
  })

  it('repairs the same dead key in two workspaces separately', async () => {
    const wsB = newWorkspaceId()
    const a = await newChat()
    await oldIngest(a, 'Set max.poll.records carefully.', ['Set max.poll.records'], 'Set max.poll.records')
    const { id: b } = await createChat(wsB)
    await oldIngest(b, 'Set max.poll.records carefully.', ['Set max.poll.records'], 'Set max.poll.records', { workspaceId: wsB })

    await run()

    expect(await state(a)).toEqual({ linked: [{ key: 'maxpollrecords', count: 1 }], headline: 'maxpollrecords' })
    expect(await state(b)).toEqual({ linked: [{ key: 'maxpollrecords', count: 1 }], headline: 'maxpollrecords' })
    const db = await getDb()
    const repaired = await db
      .select({ workspaceId: nodes.workspaceId, count: nodes.chatCount })
      .from(nodes)
      .where(eq(nodes.canonicalKey, 'maxpollrecords'))
    expect(repaired.sort((x, y) => x.workspaceId.localeCompare(y.workspaceId))).toEqual(
      [{ workspaceId: WS, count: 1 }, { workspaceId: wsB, count: 1 }].sort((x, y) => x.workspaceId.localeCompare(y.workspaceId)),
    )
    // Each chat's link points at its OWN workspace's node.
    const links = await db
      .select({ chat: sessions.workspaceId, node: nodes.workspaceId })
      .from(sessionNodes)
      .innerJoin(sessions, eq(sessions.id, sessionNodes.sessionId))
      .innerJoin(nodes, eq(nodes.id, sessionNodes.nodeId))
    expect(links.every((l) => l.chat === l.node)).toBe(true)
    expect(await db.query.nodes.findFirst({ where: eq(nodes.canonicalKey, 'setmaxpollrecords') })).toBeUndefined()
  })

  it('leaves a chat with no user messages untouched', async () => {
    const a = await newChat()
    await oldIngest(a, 'Set max.poll.records carefully.', ['Set max.poll.records'], 'Set max.poll.records', { role: 'assistant' })
    const before = await state(a)

    await run()

    expect(before).toEqual({ linked: [{ key: 'setmaxpollrecords', count: 1 }], headline: 'setmaxpollrecords' })
    expect(await state(a)).toEqual(before)
    expect(await messageKeys(a)).toEqual(['setmaxpollrecords'])
  })

  it('does not throw on a chat with no messages at all', async () => {
    const a = await newChat()

    await run()

    expect(await state(a)).toEqual({ linked: [], headline: null })
  })
})
