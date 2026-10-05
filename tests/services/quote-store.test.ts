import { beforeEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { getDb, messages, messageNodes, chatPointers } from '../../db'
import { FIXTURE_WORKSPACE_ID, newChat, truncateAll } from '../helpers/pglite'
import { finishTurn, ingestUserMessage, persistMessage, userMessageRow } from '@/services/graph'
import { loadChat } from '@/services/dbApi'
import { deleteTurn } from '@/services/turns'

beforeEach(truncateAll)
const ws = FIXTURE_WORKSPACE_ID

// Every message saved here gets its own later created_at (the `save` helper
// pattern), so (created_at, id) order is the order they were saved in.
let clock = Date.UTC(2026, 0, 1)
beforeEach(() => { clock = Date.UTC(2026, 0, 1) })
async function save(input: Parameters<typeof persistMessage>[0]) {
  const id = await persistMessage(input)
  await (await getDb()).update(messages).set({ createdAt: new Date((clock += 1000)) }).where(eq(messages.id, id))
  return id
}

const REPLY = 'Redis caches hot keys in memory.\nIt evicts the least recently used ones.'

async function chatWithReply() {
  const chat = await newChat('C')
  const askId = await save({ workspaceId: ws, sessionId: chat, role: 'user', content: 'Tell me about Redis caching.' })
  const replyId = await save({ workspaceId: ws, sessionId: chat, role: 'assistant', content: REPLY, modelUsed: 'test' })
  return { chat, askId, replyId }
}
const messagesOf = async (chat: string) => (await loadChat(ws, chat))!.messages

describe('userMessageRow', () => {
  it('builds a user row with the quote columns', () => {
    const row = userMessageRow({ sessionId: 's', content: 'hi', quote: { replyToId: 'r', start: 1, end: 4 } })
    expect(row).toMatchObject({ sessionId: 's', role: 'user', content: 'hi', replyToId: 'r', quoteStart: 1, quoteEnd: 4 })
  })
  it('leaves the quote columns null without a quote', () => {
    const row = userMessageRow({ sessionId: 's', content: 'hi' })
    expect(row).toMatchObject({ replyToId: null, quoteStart: null, quoteEnd: null })
  })
})

describe('a stored quote', () => {
  it('round-trips through loadChat, with the target role and a preview of the quoted part', async () => {
    const { chat, replyId } = await chatWithReply()
    const id = await save({ workspaceId: ws, sessionId: chat, role: 'user', content: 'Why LRU?', quote: { replyToId: replyId, start: 6, end: 20 } })
    const row = (await messagesOf(chat)).find((m) => m.id === id)!
    expect(row.quote).toEqual({ replyToId: replyId, start: 6, end: 20, role: 'assistant', preview: 'caches hot key' })
  })

  it('stores a whole-message quote with null offsets, previewing the first line', async () => {
    const { chat, replyId } = await chatWithReply()
    const id = await save({ workspaceId: ws, sessionId: chat, role: 'user', content: 'Why?', quote: { replyToId: replyId, start: null, end: null } })
    const row = (await messagesOf(chat)).find((m) => m.id === id)!
    expect(row.quote).toEqual({ replyToId: replyId, start: null, end: null, role: 'assistant', preview: 'Redis caches hot keys in memory.' })
  })

  it('cuts a long preview to 80 code points with an ellipsis', async () => {
    const chat = await newChat('C')
    const target = await save({ workspaceId: ws, sessionId: chat, role: 'assistant', content: '😀'.repeat(100) })
    const id = await save({ workspaceId: ws, sessionId: chat, role: 'user', content: 'x', quote: { replyToId: target, start: null, end: null } })
    const row = (await messagesOf(chat)).find((m) => m.id === id)!
    expect(row.quote!.preview).toBe('😀'.repeat(80) + '…')
  })

  it('is null on a message without one', async () => {
    const { chat, askId, replyId } = await chatWithReply()
    const rows = await messagesOf(chat)
    expect(rows.find((m) => m.id === askId)!.quote).toBeNull()
    expect(rows.find((m) => m.id === replyId)!.quote).toBeNull()
  })

  it('survives the quoted turn being deleted: the reply stays, the quote says its target is gone', async () => {
    const { chat, askId, replyId } = await chatWithReply()
    const id = await save({ workspaceId: ws, sessionId: chat, role: 'user', content: 'Why LRU?', quote: { replyToId: replyId, start: 6, end: 20 } })
    expect(await deleteTurn(ws, chat, replyId)).toEqual([askId, replyId])
    const rows = await messagesOf(chat)
    expect(rows.map((m) => m.id)).toEqual([id])
    expect(rows[0].quote).toEqual({ replyToId: replyId, start: 6, end: 20, role: null, preview: null })
  })

  it('never resolves a target in another chat', async () => {
    const { replyId } = await chatWithReply()
    const other = await newChat('Other')
    const id = await save({ workspaceId: ws, sessionId: other, role: 'user', content: 'x', quote: { replyToId: replyId, start: null, end: null } })
    const row = (await messagesOf(other)).find((m) => m.id === id)!
    expect(row.quote).toEqual({ replyToId: replyId, start: null, end: null, role: null, preview: null })
  })
})

describe('finishTurn with a question that carries a quote', () => {
  it('saves the quote fields on the edited question', async () => {
    const { chat, replyId } = await chatWithReply()
    const userId = await save({ workspaceId: ws, sessionId: chat, role: 'user', content: 'old' })
    const quote = { replyToId: replyId, start: 0, end: 5 }
    const done = await finishTurn({
      workspaceId: ws, sessionId: chat, messageId: userId, memoryDraft: 'Tell me about Kafka partitions.', text: 'Partitions keep order.',
      modelId: 'test', assistantMessageId: randomUUID(), pointerShift: 0, cut: [userId],
      question: { content: 'Tell me about Kafka partitions.', createdAt: new Date(), quote },
    })
    expect(done).not.toBeNull()
    const row = (await messagesOf(chat)).find((m) => m.id === userId)!
    expect(row.quote).toEqual({ ...quote, role: 'assistant', preview: 'Redis' })
  })
})

describe('a quote leaves memory alone (Q16, Q17)', () => {
  it('stores content exactly as typed and builds the same pointers and concepts as the same message without a quote', async () => {
    const typed = 'Tell me about Kafka partitions.'
    const { chat, replyId } = await chatWithReply()
    const quotedId = await save({ workspaceId: ws, sessionId: chat, role: 'user', content: typed, quote: { replyToId: replyId, start: null, end: null } })
    await ingestUserMessage({ workspaceId: ws, sessionId: chat, messageId: quotedId, content: typed })

    const plain = await newChat('Plain')
    const plainId = await save({ workspaceId: ws, sessionId: plain, role: 'user', content: typed })
    await ingestUserMessage({ workspaceId: ws, sessionId: plain, messageId: plainId, content: typed })

    const db = await getDb()
    expect((await db.select().from(messages).where(eq(messages.id, quotedId)))[0].content).toBe(typed)
    const pointers = async (id: string) =>
      (await db.select({ t: chatPointers.matchText }).from(chatPointers).where(eq(chatPointers.messageId, id))).map((r) => r.t).sort()
    const nodeIds = async (id: string) =>
      (await db.select({ n: messageNodes.nodeId }).from(messageNodes).where(eq(messageNodes.messageId, id))).map((r) => r.n).sort()
    expect((await pointers(quotedId)).length).toBeGreaterThan(0)
    expect(await pointers(quotedId)).toEqual(await pointers(plainId))
    expect((await nodeIds(quotedId)).length).toBeGreaterThan(0)
    expect(await nodeIds(quotedId)).toEqual(await nodeIds(plainId))
  })
})
