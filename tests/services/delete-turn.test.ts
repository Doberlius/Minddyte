import { beforeEach, describe, expect, it } from 'vitest'
import { and, eq, inArray } from 'drizzle-orm'
import { getDb, messages, messageNodes, nodes, sessionNodes, sessions, chatPointers } from '../../db'
import { FIXTURE_WORKSPACE_ID, newChat, truncateAll } from '../helpers/pglite'
import { ingestUserMessage, persistMessage } from '@/services/graph'
import { retrieveContext } from '@/services/retrieval'
import { forgetConcept } from '@/services/forget'
import { renameChat } from '@/services/dbApi'
import { newWorkspaceId } from '@/lib/workspace'
import { deleteTurn, removeMessages, turnAt } from '@/services/turns'

beforeEach(truncateAll)
const ws = FIXTURE_WORKSPACE_ID

async function turn(chatId: string, user: string, reply?: string) {
  const userId = await persistMessage({ workspaceId: ws, sessionId: chatId, role: 'user', content: user })
  const replyId = reply === undefined
    ? undefined
    : await persistMessage({ workspaceId: ws, sessionId: chatId, role: 'assistant', content: reply, modelUsed: 'test' })
  await ingestUserMessage({ workspaceId: ws, sessionId: chatId, messageId: userId, content: user, assistantContent: reply, assistantMessageId: replyId })
  return { userId, replyId: replyId! }
}
const nodesOf = async (messageId: string) =>
  (await (await getDb()).select({ id: messageNodes.nodeId }).from(messageNodes).where(eq(messageNodes.messageId, messageId))).map((r) => r.id)
const linked = async (chatId: string) =>
  (await (await getDb()).select({ id: sessionNodes.nodeId }).from(sessionNodes).where(eq(sessionNodes.sessionId, chatId))).map((r) => r.id)
const messageIds = async (chatId: string) =>
  (await (await getDb()).select({ id: messages.id }).from(messages).where(eq(messages.sessionId, chatId)).orderBy(messages.createdAt, messages.id)).map((r) => r.id)

describe('turnAt', () => {
  const all = [
    { id: 'u1', role: 'user' }, // a failed send: no reply
    { id: 'u2', role: 'user' },
    { id: 'a2', role: 'assistant' },
  ]
  it('takes a user message and the reply directly after it', () => expect(turnAt(all, 1)).toEqual(['u2', 'a2']))
  it('takes a reply and the user message directly before it', () => expect(turnAt(all, 2)).toEqual(['u2', 'a2']))
  it('takes a user message alone when the next message is not its reply', () => expect(turnAt(all, 0)).toEqual(['u1']))
})

describe('deleteTurn', () => {
  it('deletes both halves of the turn, given either id', async () => {
    for (const pick of ['user', 'reply'] as const) {
      await truncateAll()
      const chat = await newChat('C')
      const keep = await turn(chat, 'Tell me about Redis caching.', 'Redis caches hot keys.')
      const gone = await turn(chat, 'Tell me about Kafka partitions.', 'Partitions keep order.')
      const deleted = await deleteTurn(ws, chat, pick === 'user' ? gone.userId : gone.replyId)
      expect(deleted).toEqual([gone.userId, gone.replyId])
      expect(await messageIds(chat)).toEqual([keep.userId, keep.replyId])
      const db = await getDb()
      expect(await db.select().from(chatPointers).where(inArray(chatPointers.messageId, [gone.userId, gone.replyId]))).toEqual([])
    }
  })

  it('unlinks a concept only the deleted turn mentioned, and deletes the Node when no chat holds it', async () => {
    const chat = await newChat('C')
    const keep = await turn(chat, 'Tell me about Redis caching.', 'Sure.')
    const gone = await turn(chat, 'Tell me about Kafka partitions.', 'Sure.')
    const keptIds = await nodesOf(keep.userId)
    const only = (await nodesOf(gone.userId)).filter((id) => !keptIds.includes(id))
    expect(only.length).toBeGreaterThan(0)
    await deleteTurn(ws, chat, gone.userId)
    const db = await getDb()
    for (const id of only) {
      expect(await linked(chat)).not.toContain(id)
      expect(await db.select().from(nodes).where(eq(nodes.id, id))).toEqual([])
    }
  })

  it('keeps a concept another turn of the same chat still mentions', async () => {
    const chat = await newChat('C')
    const keep = await turn(chat, 'Tell me about Kafka partitions.', 'Sure.')
    const gone = await turn(chat, 'More about Kafka partitions please.', 'Sure.')
    const shared = await nodesOf(gone.userId)
    const keptIds = await nodesOf(keep.userId)
    const both = shared.filter((id) => keptIds.includes(id))
    expect(both.length).toBeGreaterThan(0)
    await deleteTurn(ws, chat, gone.userId)
    for (const id of both) expect(await linked(chat)).toContain(id)
  })

  it('lowers chat_count by one for a concept another chat still holds', async () => {
    const other = await newChat('Other')
    await turn(other, 'Tell me about Kafka partitions.', 'Sure.')
    const chat = await newChat('C')
    const gone = await turn(chat, 'Tell me about Kafka partitions.', 'Sure.')
    const db = await getDb()
    const ids = await nodesOf(gone.userId)
    const before = await db.select({ id: nodes.id, n: nodes.chatCount }).from(nodes).where(inArray(nodes.id, ids))
    expect(before.length).toBeGreaterThan(0)
    for (const b of before) expect(b.n).toBe(2)
    await deleteTurn(ws, chat, gone.userId)
    const after = await db.select({ id: nodes.id, n: nodes.chatCount }).from(nodes).where(inArray(nodes.id, ids))
    expect(after.length).toBe(before.length)
    for (const b of before) expect(after.find((a) => a.id === b.id)!.n).toBe(b.n - 1)
  })

  it('stops other chats reaching the deleted text, the whole-draft backup included', async () => {
    const chat = await newChat('Logs')
    await turn(chat, 'Tell me about Redis caching.', 'Redis caches hot keys in memory.')
    const gone = await turn(chat, 'What are the defaults?', 'The retention period for audit logs is ninety days by default.')
    const asker = await newChat('B')
    const ask = () => retrieveContext({ workspaceId: ws, sessionId: asker, mode: 'explore', taggedChatIds: [], draftText: 'how long do we keep audit logs' })
    expect((await ask()).chats.map((c) => c.id)).toContain(chat)
    await deleteTurn(ws, chat, gone.replyId)
    expect((await ask()).chats.map((c) => c.id)).not.toContain(chat)
  })

  it('keeps a renamed title and re-derives the headline when the first turn goes', async () => {
    const chat = await newChat()
    const first = await turn(chat, 'Tell me about Kafka partitions.', 'Sure.')
    await turn(chat, 'Tell me about Redis caching.', 'Sure.')
    expect(await renameChat(ws, chat, 'My own name')).toBe(true)
    const db = await getDb()
    const [before] = await db.select({ h: sessions.headlineNodeId }).from(sessions).where(eq(sessions.id, chat))
    await deleteTurn(ws, chat, first.userId)
    const [after] = await db.select({ t: sessions.title, h: sessions.headlineNodeId }).from(sessions).where(eq(sessions.id, chat))
    expect(after.t).toBe('My own name')
    expect(after.h).not.toBe(before.h)
    if (after.h) expect(await linked(chat)).toContain(after.h)
  })

  it('leaves an empty chat when its only turn is deleted', async () => {
    const chat = await newChat('C')
    const only = await turn(chat, 'Tell me about Kafka partitions.', 'Sure.')
    await deleteTurn(ws, chat, only.userId)
    const db = await getDb()
    expect(await db.select().from(sessions).where(eq(sessions.id, chat))).toHaveLength(1)
    expect(await messageIds(chat)).toEqual([])
    expect(await linked(chat)).toEqual([])
  })

  it('deletes a failed send alone, never the next turn’s reply', async () => {
    const chat = await newChat('C')
    const failed = await turn(chat, 'Tell me about Kafka partitions.')
    const next = await turn(chat, 'Tell me about Redis caching.', 'Sure.')
    expect(await deleteTurn(ws, chat, failed.userId)).toEqual([failed.userId])
    expect(await messageIds(chat)).toEqual([next.userId, next.replyId])
  })

  it('keeps a forgotten concept forgotten', async () => {
    const chat = await newChat('C')
    await turn(chat, 'Tell me about Kafka partitions.', 'Sure.')
    const gone = await turn(chat, 'Tell me about Redis caching.', 'Sure.')
    const db = await getDb()
    const [k] = await db
      .select({ key: nodes.canonicalKey, id: nodes.id })
      .from(sessionNodes).innerJoin(nodes, eq(nodes.id, sessionNodes.nodeId))
      .where(and(eq(sessionNodes.sessionId, chat), inArray(nodes.id, await nodesOf((await messageIds(chat))[0]))))
    expect(await forgetConcept(ws, chat, k.key)).toBe(true)
    await deleteTurn(ws, chat, gone.userId)
    expect(await linked(chat)).not.toContain(k.id)
  })

  it('refuses another workspace’s chat, and a message from another chat, changing nothing', async () => {
    const chat = await newChat('C')
    const t = await turn(chat, 'Tell me about Kafka partitions.', 'Sure.')
    const other = await newChat('D')
    const o = await turn(other, 'Tell me about Redis caching.', 'Sure.')
    expect(await deleteTurn(newWorkspaceId(), chat, t.userId)).toBeNull()
    expect(await deleteTurn(ws, chat, o.userId)).toBeNull()
    expect(await messageIds(chat)).toEqual([t.userId, t.replyId])
    expect(await messageIds(other)).toEqual([o.userId, o.replyId])
  })
})

describe('removeMessages', () => {
  it('runs inside the caller’s transaction: a throw rolls back the removal and the caller’s own write', async () => {
    const chat = await newChat('C')
    const t = await turn(chat, 'Tell me about Kafka partitions.', 'Sure.')
    const db = await getDb()
    const [before] = await db.select({ title: sessions.title }).from(sessions).where(eq(sessions.id, chat))
    await expect(
      db.transaction(async (tx) => {
        await tx.update(sessions).set({ title: 'Changed in the same transaction' }).where(eq(sessions.id, chat))
        await removeMessages(tx, ws, chat, [t.userId, t.replyId])
        throw new Error('rollback')
      }),
    ).rejects.toThrow('rollback')
    expect(await messageIds(chat)).toEqual([t.userId, t.replyId])
    const [row] = await db.select({ title: sessions.title }).from(sessions).where(eq(sessions.id, chat))
    expect(row.title).toBe(before.title)
  })
})
