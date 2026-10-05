import { beforeEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { getDb, messages, sessions, chatPointers } from '../../db'
import { FIXTURE_WORKSPACE_ID, newChat, truncateAll } from '../helpers/pglite'
import { finishTurn, ingestUserMessage, persistMessage } from '@/services/graph'
import { loadChat, renameChat } from '@/services/dbApi'
import { retrieveContext } from '@/services/retrieval'
import { deriveTitle } from '@/lib/text'
import { deleteTurn, planTurn } from '@/services/turns'

beforeEach(truncateAll)
const ws = FIXTURE_WORKSPACE_ID

let clock = Date.UTC(2026, 0, 1)
beforeEach(() => { clock = Date.UTC(2026, 0, 1) })
async function save(input: Parameters<typeof persistMessage>[0]) {
  const id = await persistMessage(input)
  await (await getDb()).update(messages).set({ createdAt: new Date((clock += 1000)) }).where(eq(messages.id, id))
  return id
}
async function turn(chatId: string, user: string, reply: string) {
  const userId = await save({ workspaceId: ws, sessionId: chatId, role: 'user', content: user })
  const replyId = await save({ workspaceId: ws, sessionId: chatId, role: 'assistant', content: reply, modelUsed: 'test' })
  await ingestUserMessage({ workspaceId: ws, sessionId: chatId, messageId: userId, content: user, assistantContent: reply, assistantMessageId: replyId })
  return { userId, replyId }
}
const order = async (chat: string) => (await loadChat(ws, chat))!.messages.map((m) => ({ id: m.id, content: m.content }))
/** The cut a browser showing this chat expects: the target and everything after it (final review F1). */
const shownFrom = async (chat: string, id: string) => {
  const ids = (await order(chat)).map((m) => m.id)
  return ids.slice(ids.indexOf(id))
}

async function edit(chat: string, messageId: string, content: string, reply: string) {
  const plan = await planTurn(ws, chat, { trigger: 'submit-message', messageId, lastId: messageId, expectCut: await shownFrom(chat, messageId) })
  if (plan.kind !== 'edit') throw new Error(`expected an edit, got ${plan.kind}`)
  const replyId = randomUUID()
  const done = await finishTurn({
    workspaceId: ws, sessionId: chat, messageId, memoryDraft: content, text: reply, modelId: 'test',
    assistantMessageId: replyId, pointerShift: 0, cut: plan.cut, question: { content, createdAt: new Date() },
  })
  return { done, replyId }
}
async function regenerate(chat: string, replyOf: string, question: string, reply: string) {
  const plan = await planTurn(ws, chat, { trigger: 'regenerate-message', messageId: replyOf, lastId: question, expectCut: await shownFrom(chat, replyOf) })
  if (plan.kind !== 'regenerate') throw new Error(`expected a regenerate, got ${plan.kind}`)
  const [q] = await (await getDb()).select({ content: messages.content }).from(messages).where(eq(messages.id, question))
  const replyId = randomUUID()
  const done = await finishTurn({
    workspaceId: ws, sessionId: chat, messageId: question, memoryDraft: q.content, text: reply, modelId: 'test',
    assistantMessageId: replyId, pointerShift: 0, cut: plan.cut,
  })
  return { done, replyId }
}

describe('edit (ticket 02)', () => {
  it('cuts from the edited message, keeps its id, and orders the new turn last', async () => {
    const chat = await newChat()
    const t1 = await turn(chat, 'Tell me about Redis caching.', 'Redis caches hot keys.')
    const t2 = await turn(chat, 'Tell me about Kafka partitions.', 'Partitions keep order.')
    await turn(chat, 'And Postgres vacuum?', 'Vacuum reclaims dead rows.')
    const { done, replyId } = await edit(chat, t2.userId, 'Tell me about Kafka consumer groups.', 'Groups share partitions.')
    expect(done).not.toBeNull()
    expect(await order(chat)).toEqual([
      { id: t1.userId, content: 'Tell me about Redis caching.' },
      { id: t1.replyId, content: 'Redis caches hot keys.' },
      { id: t2.userId, content: 'Tell me about Kafka consumer groups.' },
      { id: replyId, content: 'Groups share partitions.' },
    ])
  })

  it('removes the old text from memory and indexes the new', async () => {
    const chat = await newChat()
    await turn(chat, 'Tell me about Redis caching.', 'Redis caches hot keys in memory.')
    const t2 = await turn(chat, 'What are the defaults?', 'The retention period for audit logs is ninety days by default.')
    const asker = await newChat()
    const ask = (draftText: string) => retrieveContext({ workspaceId: ws, sessionId: asker, mode: 'explore', taggedChatIds: [], draftText })
    expect((await ask('how long do we keep audit logs')).chats.map((c) => c.id)).toContain(chat)
    await edit(chat, t2.userId, 'What is our backup schedule?', 'Backups run nightly at two in the morning with weekly snapshots.')
    expect((await ask('how long do we keep audit logs')).chats.map((c) => c.id)).not.toContain(chat)
    expect((await ask('when do backups run nightly snapshots')).chats.map((c) => c.id)).toContain(chat)
    const db = await getDb()
    expect((await db.select().from(chatPointers).where(eq(chatPointers.messageId, t2.userId))).length).toBeGreaterThan(0)
  })

  it('re-titles an automatic title from the edited first message, and keeps a chosen one', async () => {
    const auto = await newChat()
    const a = await turn(auto, 'Tell me about Kafka partitions.', 'Sure.')
    await edit(auto, a.userId, 'Tell me about Redis caching.', 'Sure.')
    const named = await newChat()
    const b = await turn(named, 'Tell me about Kafka partitions.', 'Sure.')
    expect(await renameChat(ws, named, 'Mine')).toBe(true)
    await edit(named, b.userId, 'Tell me about Redis caching.', 'Sure.')
    const db = await getDb()
    const title = async (id: string) => (await db.select({ t: sessions.title }).from(sessions).where(eq(sessions.id, id)))[0].t
    expect(await title(auto)).toBe(deriveTitle('Tell me about Redis caching.'))
    expect(await title(named)).toBe('Mine')
  })
})

describe('regenerate (ticket 02)', () => {
  it('replaces only the last reply, keeping the question', async () => {
    const chat = await newChat()
    const t1 = await turn(chat, 'Tell me about Redis caching.', 'Redis caches hot keys.')
    const { replyId } = await regenerate(chat, t1.replyId, t1.userId, 'Redis keeps data in memory.')
    expect(await order(chat)).toEqual([
      { id: t1.userId, content: 'Tell me about Redis caching.' },
      { id: replyId, content: 'Redis keeps data in memory.' },
    ])
  })

  it('cuts every turn after a regenerated middle reply', async () => {
    const chat = await newChat()
    const t1 = await turn(chat, 'Tell me about Redis caching.', 'Redis caches hot keys.')
    await turn(chat, 'Tell me about Kafka partitions.', 'Partitions keep order.')
    const { replyId } = await regenerate(chat, t1.replyId, t1.userId, 'Redis keeps data in memory.')
    expect((await order(chat)).map((m) => m.id)).toEqual([t1.userId, replyId])
  })

  it('saves nothing when the question was deleted while the reply streamed', async () => {
    const chat = await newChat()
    const t1 = await turn(chat, 'Tell me about Redis caching.', 'Redis caches hot keys.')
    const plan = await planTurn(ws, chat, { trigger: 'regenerate-message', messageId: t1.replyId, lastId: t1.userId, expectCut: await shownFrom(chat, t1.replyId) })
    if (plan.kind !== 'regenerate') throw new Error('expected a regenerate')
    await deleteTurn(ws, chat, t1.userId)
    const done = await finishTurn({
      workspaceId: ws, sessionId: chat, messageId: t1.userId, memoryDraft: 'x', text: 'y', modelId: 'test',
      assistantMessageId: randomUUID(), pointerShift: 0, cut: plan.cut,
    })
    expect(done).toBeNull()
    expect(await order(chat)).toEqual([])
  })
})

describe('a question deleted while the reply streamed (fix round 1)', () => {
  it('a regenerate whose question vanished removes nothing else', async () => {
    const chat = await newChat()
    const t1 = await turn(chat, 'Tell me about Redis caching.', 'Redis caches hot keys.')
    const t2 = await turn(chat, 'Tell me about Kafka partitions.', 'Partitions keep order.')
    const plan = await planTurn(ws, chat, { trigger: 'regenerate-message', messageId: t1.replyId, lastId: t1.userId, expectCut: await shownFrom(chat, t1.replyId) })
    if (plan.kind !== 'regenerate') throw new Error('expected a regenerate')
    await deleteTurn(ws, chat, t1.userId)
    const done = await finishTurn({
      workspaceId: ws, sessionId: chat, messageId: t1.userId, memoryDraft: 'x', text: 'y', modelId: 'test',
      assistantMessageId: randomUUID(), pointerShift: 0, cut: plan.cut,
    })
    expect(done).toBeNull()
    expect(await order(chat)).toEqual([
      { id: t2.userId, content: 'Tell me about Kafka partitions.' },
      { id: t2.replyId, content: 'Partitions keep order.' },
    ])
  })

  it('an edit whose question vanished does not bring it back', async () => {
    const chat = await newChat()
    const t1 = await turn(chat, 'Tell me about Redis caching.', 'Redis caches hot keys.')
    const t2 = await turn(chat, 'Tell me about Kafka partitions.', 'Partitions keep order.')
    const plan = await planTurn(ws, chat, { trigger: 'submit-message', messageId: t2.userId, lastId: t2.userId, expectCut: await shownFrom(chat, t2.userId) })
    if (plan.kind !== 'edit') throw new Error('expected an edit')
    await deleteTurn(ws, chat, t2.userId)
    const done = await finishTurn({
      workspaceId: ws, sessionId: chat, messageId: t2.userId, memoryDraft: 'z', text: 'y', modelId: 'test',
      assistantMessageId: randomUUID(), pointerShift: 0, cut: plan.cut, question: { content: 'z', createdAt: new Date() },
    })
    expect(done).toBeNull()
    expect(await order(chat)).toEqual([
      { id: t1.userId, content: 'Tell me about Redis caching.' },
      { id: t1.replyId, content: 'Redis caches hot keys.' },
    ])
  })

  it('an edited question sorts after a remaining message dated in the future', async () => {
    const chat = await newChat()
    const t1 = await turn(chat, 'Tell me about Redis caching.', 'Redis caches hot keys.')
    const t2 = await turn(chat, 'Tell me about Kafka partitions.', 'Partitions keep order.')
    const plan = await planTurn(ws, chat, { trigger: 'submit-message', messageId: t2.userId, lastId: t2.userId, expectCut: await shownFrom(chat, t2.userId) })
    if (plan.kind !== 'edit') throw new Error('expected an edit')
    // Another tab dates a message ahead of the clock after the plan was made and before the reply finishes.
    await (await getDb()).update(messages).set({ createdAt: new Date(Date.now() + 3_600_000) }).where(eq(messages.id, t1.replyId))
    const replyId = randomUUID()
    await finishTurn({
      workspaceId: ws, sessionId: chat, messageId: t2.userId, memoryDraft: 'q', text: 'Sure.', modelId: 'test',
      assistantMessageId: replyId, pointerShift: 0, cut: plan.cut, question: { content: 'q', createdAt: new Date() },
    })
    expect((await order(chat)).map((m) => m.id)).toEqual([t1.userId, t1.replyId, t2.userId, replyId])
  })

  it('a second swap of the same cut saves nothing (final review F4)', async () => {
    const chat = await newChat()
    const t1 = await turn(chat, 'Tell me about Redis caching.', 'Redis caches hot keys.')
    const plan = async () => {
      const p = await planTurn(ws, chat, { trigger: 'regenerate-message', messageId: t1.replyId, lastId: t1.userId, expectCut: [t1.replyId] })
      if (p.kind !== 'regenerate') throw new Error('expected a regenerate')
      return p
    }
    const [first, second] = [await plan(), await plan()]
    const finish = (cut: string[], text: string) => finishTurn({
      workspaceId: ws, sessionId: chat, messageId: t1.userId, memoryDraft: 'Tell me about Redis caching.', text, modelId: 'test',
      assistantMessageId: randomUUID(), pointerShift: 0, cut,
    })
    expect(await finish(first.cut, 'First answer.')).not.toBeNull()
    expect(await finish(second.cut, 'Second answer.')).toBeNull()
    expect((await order(chat)).map((m) => m.content)).toEqual(['Tell me about Redis caching.', 'First answer.'])
  })

  it('a regenerated reply sorts after a remaining message dated in the future (final review F5)', async () => {
    const chat = await newChat()
    const t1 = await turn(chat, 'Tell me about Redis caching.', 'Redis caches hot keys.')
    const t2 = await turn(chat, 'Tell me about Kafka partitions.', 'Partitions keep order.')
    const plan = await planTurn(ws, chat, { trigger: 'regenerate-message', messageId: t2.replyId, lastId: t2.userId, expectCut: [t2.replyId] })
    if (plan.kind !== 'regenerate') throw new Error('expected a regenerate')
    await (await getDb()).update(messages).set({ createdAt: new Date(Date.now() + 3_600_000) }).where(eq(messages.id, t1.replyId))
    const replyId = randomUUID()
    await finishTurn({
      workspaceId: ws, sessionId: chat, messageId: t2.userId, memoryDraft: 'q', text: 'Sure.', modelId: 'test',
      assistantMessageId: replyId, pointerShift: 0, cut: plan.cut,
    })
    expect((await order(chat)).map((m) => m.id).at(-1)).toBe(replyId)
  })

  it('editing a later message leaves an automatic title alone', async () => {
    const chat = await newChat()
    await turn(chat, 'Tell me about Redis caching.', 'Sure.')
    const t2 = await turn(chat, 'Tell me about Kafka partitions.', 'Sure.')
    const db = await getDb()
    const title = async () => (await db.select({ t: sessions.title }).from(sessions).where(eq(sessions.id, chat)))[0].t
    const before = await title()
    await edit(chat, t2.userId, 'Tell me about Postgres vacuum.', 'Sure.')
    expect(await title()).toBe(before)
  })
})
