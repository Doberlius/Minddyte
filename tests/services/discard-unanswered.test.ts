import { beforeEach, describe, expect, it } from 'vitest'
import { eq, inArray } from 'drizzle-orm'
import { getDb, messages, messageNodes, nodes, sessionNodes, sessions, chatPointers } from '../../db'
import { FIXTURE_WORKSPACE_ID, newChat, truncateAll } from '../helpers/pglite'
import { ingestUserMessage, persistMessage } from '@/services/graph'
import { newWorkspaceId } from '@/lib/workspace'
import { deriveTitle } from '@/lib/text'
import { discardUnanswered } from '@/services/turns'

beforeEach(truncateAll)
const ws = FIXTURE_WORKSPACE_ID

// Each message gets its own later created_at (see delete-turn.test.ts): turn
// order is (created_at, id), and back-to-back inserts can share a time.
let clock = Date.UTC(2026, 0, 1)
beforeEach(() => { clock = Date.UTC(2026, 0, 1) })
async function save(input: Parameters<typeof persistMessage>[0]) {
  const id = await persistMessage(input)
  await (await getDb()).update(messages).set({ createdAt: new Date((clock += 1000)) }).where(eq(messages.id, id))
  return id
}
/** A turn; without a reply it is a failed send's question. Indexed either way, so memory has something to lose. */
async function turn(chatId: string, user: string, reply?: string) {
  const userId = await save({ workspaceId: ws, sessionId: chatId, role: 'user', content: user })
  const replyId = reply === undefined
    ? undefined
    : await save({ workspaceId: ws, sessionId: chatId, role: 'assistant', content: reply, modelUsed: 'test' })
  await ingestUserMessage({ workspaceId: ws, sessionId: chatId, messageId: userId, content: user, assistantContent: reply, assistantMessageId: replyId })
  return { userId, replyId: replyId! }
}

const db = async () => getDb()
const nodesOf = async (messageId: string) =>
  (await (await db()).select({ id: messageNodes.nodeId }).from(messageNodes).where(eq(messageNodes.messageId, messageId))).map((r) => r.id)
const linked = async (chatId: string) =>
  (await (await db()).select({ id: sessionNodes.nodeId }).from(sessionNodes).where(eq(sessionNodes.sessionId, chatId))).map((r) => r.id)
const messageIds = async (chatId: string) =>
  (await (await db()).select({ id: messages.id }).from(messages).where(eq(messages.sessionId, chatId)).orderBy(messages.createdAt, messages.id)).map((r) => r.id)
const titleOf = async (chatId: string) =>
  (await (await db()).select({ t: sessions.title }).from(sessions).where(eq(sessions.id, chatId)))[0].t

/** Everything a discard could touch, for "nothing changes". */
async function snapshot() {
  const d = await db()
  return {
    messages: await d.select().from(messages).orderBy(messages.id),
    sessions: await d.select().from(sessions).orderBy(sessions.id),
    sessionNodes: await d.select().from(sessionNodes).orderBy(sessionNodes.sessionId, sessionNodes.nodeId),
    messageNodes: await d.select().from(messageNodes).orderBy(messageNodes.messageId, messageNodes.nodeId),
    nodes: await d.select({ id: nodes.id, n: nodes.chatCount }).from(nodes).orderBy(nodes.id),
    pointers: await d.select().from(chatPointers).orderBy(chatPointers.messageId, chatPointers.ordinal),
  }
}

describe('discardUnanswered', () => {
  it('removes an unanswered question and everything memory built from it', async () => {
    const chat = await newChat('C')
    const keep = await turn(chat, 'Tell me about Redis caching.', 'Redis caches hot keys.')
    const failed = await turn(chat, 'Tell me about Kafka partitions.')
    const keptIds = await nodesOf(keep.userId)
    const only = (await nodesOf(failed.userId)).filter((id) => !keptIds.includes(id))
    expect(only.length).toBeGreaterThan(0)
    const d = await db()
    expect((await d.select().from(chatPointers).where(eq(chatPointers.messageId, failed.userId))).length).toBeGreaterThan(0)

    expect(await discardUnanswered(ws, chat, failed.userId)).toBe(true)

    expect(await messageIds(chat)).toEqual([keep.userId, keep.replyId])
    expect(await d.select().from(chatPointers).where(eq(chatPointers.messageId, failed.userId))).toEqual([])
    expect(await nodesOf(failed.userId)).toEqual([])
    for (const id of only) {
      expect(await linked(chat)).not.toContain(id)
      expect(await d.select().from(nodes).where(eq(nodes.id, id))).toEqual([])
    }
  })

  it('puts an automatic title back to the new-chat name when the question was the only message', async () => {
    const chat = await newChat()
    const failed = await turn(chat, 'Tell me about Kafka partitions.')
    expect(await titleOf(chat)).toBe(deriveTitle('Tell me about Kafka partitions.'))
    expect(await discardUnanswered(ws, chat, failed.userId)).toBe(true)
    expect(await messageIds(chat)).toEqual([])
    expect(await linked(chat)).toEqual([])
    expect(await titleOf(chat)).toBe('New Session')
  })

  it('leaves an answered question alone', async () => {
    const chat = await newChat('C')
    const answered = await turn(chat, 'Tell me about Kafka partitions.', 'Partitions keep order.')
    const before = await snapshot()
    expect(await discardUnanswered(ws, chat, answered.userId)).toBe(false)
    expect(await snapshot()).toEqual(before)
  })

  it("refuses an assistant message, another chat's message, and another workspace's chat", async () => {
    const chat = await newChat('C')
    const answered = await turn(chat, 'Tell me about Kafka partitions.', 'Partitions keep order.')
    const failed = await turn(chat, 'Tell me about Redis caching.')
    const other = await newChat('Other')
    const before = await snapshot()
    expect(await discardUnanswered(ws, chat, answered.replyId)).toBe(false)
    expect(await discardUnanswered(ws, other, failed.userId)).toBe(false)
    expect(await discardUnanswered(newWorkspaceId(), chat, failed.userId)).toBe(false)
    expect(await snapshot()).toEqual(before)
  })

  it('removes only the id it was given, never an earlier failed question', async () => {
    const chat = await newChat('C')
    const earlier = await turn(chat, 'Tell me about Redis caching.')
    const middle = await turn(chat, 'Tell me about Kafka partitions.', 'Partitions keep order.')
    const latest = await turn(chat, 'And Postgres vacuum?')
    expect(await discardUnanswered(ws, chat, latest.userId)).toBe(true)
    expect(await messageIds(chat)).toEqual([earlier.userId, middle.userId, middle.replyId])
    // The earlier one is unanswered too (the next message is a question), so
    // it can be discarded by its own id, and that takes nothing else.
    expect(await discardUnanswered(ws, chat, earlier.userId)).toBe(true)
    expect(await messageIds(chat)).toEqual([middle.userId, middle.replyId])
    const d = await db()
    expect(await d.select().from(chatPointers).where(inArray(chatPointers.messageId, [middle.userId, middle.replyId]))).not.toEqual([])
  })
})
