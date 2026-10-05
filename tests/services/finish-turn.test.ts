import { beforeEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { loadChat } from '@/services/dbApi'
import { getDb, messages, chatPointers } from '../../db'
import { FIXTURE_WORKSPACE_ID, newChat, truncateAll } from '../helpers/pglite'
import { finishTurn, persistMessage } from '@/services/graph'
import { deleteTurn } from '@/services/turns'

beforeEach(truncateAll)
const ws = FIXTURE_WORKSPACE_ID

describe('persistMessage with an id chosen by the browser', () => {
  it('stores the message under that id', async () => {
    const chat = await newChat('C')
    const id = randomUUID()
    expect(await persistMessage({ workspaceId: ws, sessionId: chat, role: 'user', content: 'hi there', id })).toBe(id)
  })

  it('falls back to a fresh id when that id is already taken, instead of failing the send', async () => {
    const chat = await newChat('C')
    const id = randomUUID()
    await persistMessage({ workspaceId: ws, sessionId: chat, role: 'user', content: 'first', id })
    const second = await persistMessage({ workspaceId: ws, sessionId: chat, role: 'user', content: 'second', id })
    expect(second).not.toBe(id)
    const db = await getDb()
    expect((await db.select().from(messages).where(eq(messages.sessionId, chat))).length).toBe(2)
  })
})

describe('finishTurn', () => {
  const finish = (chat: string, messageId: string, assistantMessageId = randomUUID()) =>
    finishTurn({ workspaceId: ws, sessionId: chat, messageId, memoryDraft: 'Tell me about Kafka partitions.', text: 'Partitions keep order.', modelId: 'test', assistantMessageId, pointerShift: 0 })

  it('saves the reply under the chosen id and indexes both halves', async () => {
    const chat = await newChat('C')
    const userId = await persistMessage({ workspaceId: ws, sessionId: chat, role: 'user', content: 'Tell me about Kafka partitions.' })
    const replyId = randomUUID()
    expect(await finish(chat, userId, replyId)).not.toBeNull()
    const db = await getDb()
    expect((await db.select().from(messages).where(eq(messages.id, replyId))).length).toBe(1)
    expect((await db.select().from(chatPointers).where(eq(chatPointers.messageId, replyId))).length).toBeGreaterThan(0)
  })

  it('saves nothing when the question was deleted while the reply streamed', async () => {
    const chat = await newChat('C')
    const userId = await persistMessage({ workspaceId: ws, sessionId: chat, role: 'user', content: 'Tell me about Kafka partitions.' })
    expect(await deleteTurn(ws, chat, userId)).toEqual([userId])
    expect(await finish(chat, userId)).toBeNull()
    const db = await getDb()
    expect(await db.select().from(messages).where(eq(messages.sessionId, chat))).toEqual([])
  })
})

describe('finishTurn, as one transaction (message-actions ticket 02)', () => {
  it('orders the reply after its question even when both are saved at once', async () => {
    for (let n = 0; n < 10; n++) {
      await truncateAll()
      const chat = await newChat()
      const userId = await persistMessage({ workspaceId: ws, sessionId: chat, role: 'user', content: 'Tell me about Kafka partitions.' })
      const replyId = randomUUID()
      expect(await finishTurn({ workspaceId: ws, sessionId: chat, messageId: userId, memoryDraft: 'Tell me about Kafka partitions.', text: 'Partitions keep order.', modelId: 'test', assistantMessageId: replyId, pointerShift: 0 })).not.toBeNull()
      expect((await loadChat(ws, chat))!.messages.map((m) => m.id)).toEqual([userId, replyId])
    }
  })

  it('saves no reply when indexing fails', async () => {
    const chat = await newChat()
    const userId = await persistMessage({ workspaceId: ws, sessionId: chat, role: 'user', content: 'Tell me about Kafka partitions.' })
    const replyId = randomUUID()
    // A foreign workspace makes ingest's ownership check throw, after the reply's insert.
    await expect(finishTurn({ workspaceId: randomUUID(), sessionId: chat, messageId: userId, memoryDraft: 'x', text: 'y', modelId: 'test', assistantMessageId: replyId, pointerShift: 0 })).rejects.toThrow()
    const db = await getDb()
    expect(await db.select().from(messages).where(eq(messages.id, replyId))).toEqual([])
  })
})

describe('loadChat order', () => {
  it('breaks a created_at tie by id', async () => {
    const chat = await newChat()
    const a = await persistMessage({ workspaceId: ws, sessionId: chat, role: 'user', content: 'one' })
    const b = await persistMessage({ workspaceId: ws, sessionId: chat, role: 'assistant', content: 'two' })
    const db = await getDb()
    await db.execute(sql`update messages set created_at = '2026-01-01T00:00:00Z' where session_id = ${chat}`)
    expect((await loadChat(ws, chat))!.messages.map((m) => m.id)).toEqual([a, b].sort())
  })
})
