import { beforeEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
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
