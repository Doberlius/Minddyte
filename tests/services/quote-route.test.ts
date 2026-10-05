import { beforeEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { eq, inArray } from 'drizzle-orm'
import type { UIMessage } from 'ai'
import { getDb, messages, messageNodes, chatPointers, nodes } from '../../db'
import { FIXTURE_WORKSPACE_ID, newChat, truncateAll } from '../helpers/pglite'
import { finishTurn, ingestUserMessage, persistMessage } from '@/services/graph'
import { createChat } from '@/services/dbApi'
import { retrieveContext } from '@/services/retrieval'
import { checkQuote, deleteTurn, quotesForModel } from '@/services/turns'
import { withQuotes } from '@/lib/quote-prompt'
import { newWorkspaceId } from '@/lib/workspace'
import { stripVisualize, visualizePrefixLength } from '@/lib/scene/intent'

beforeEach(truncateAll)
const ws = FIXTURE_WORKSPACE_ID

let clock = Date.UTC(2026, 0, 1)
beforeEach(() => { clock = Date.UTC(2026, 0, 1) })
async function save(input: Parameters<typeof persistMessage>[0]) {
  const id = await persistMessage(input)
  await (await getDb()).update(messages).set({ createdAt: new Date((clock += 1000)) }).where(eq(messages.id, id))
  return id
}

const ASK = 'Tell me about Redis caching.'
const REPLY = 'Redis caches hot keys in memory.\nIt evicts the least recently used ones.'

async function chatWithReply() {
  const chat = await newChat('C')
  const askId = await save({ workspaceId: ws, sessionId: chat, role: 'user', content: ASK })
  const replyId = await save({ workspaceId: ws, sessionId: chat, role: 'assistant', content: REPLY, modelUsed: 'test' })
  return { chat, askId, replyId }
}

const REFUSED = { ok: false, message: 'That quote can’t be used. Remove it and try again.' }

describe('checkQuote (ticket 03)', () => {
  it('accepts no quote', async () => {
    const { chat } = await chatWithReply()
    expect(await checkQuote(ws, chat, null)).toEqual({ ok: true, quote: null })
    expect(await checkQuote(ws, chat, undefined)).toEqual({ ok: true, quote: null })
  })

  it('accepts a whole-message quote of a message in this chat', async () => {
    const { chat, replyId } = await chatWithReply()
    const quote = { replyToId: replyId, start: null, end: null }
    expect(await checkQuote(ws, chat, quote)).toEqual({ ok: true, quote })
  })

  it('accepts a valid highlighted part, and keeps only the quote fields', async () => {
    const { chat, askId } = await chatWithReply()
    const raw = { replyToId: askId, start: 0, end: 5, text: 'from the browser' }
    expect(await checkQuote(ws, chat, raw)).toEqual({ ok: true, quote: { replyToId: askId, start: 0, end: 5 } })
  })

  it('refuses a message of another chat', async () => {
    const { replyId } = await chatWithReply()
    const other = await newChat('Other')
    expect(await checkQuote(ws, other, { replyToId: replyId, start: null, end: null })).toEqual(REFUSED)
  })

  it('refuses a chat of another workspace', async () => {
    const { chat, replyId } = await chatWithReply()
    expect(await checkQuote(newWorkspaceId(), chat, { replyToId: replyId, start: null, end: null })).toEqual(REFUSED)
  })

  it('refuses an unknown id, and a non-uuid', async () => {
    const { chat } = await chatWithReply()
    expect(await checkQuote(ws, chat, { replyToId: randomUUID(), start: null, end: null })).toEqual(REFUSED)
    expect(await checkQuote(ws, chat, { replyToId: 'not-a-uuid', start: null, end: null })).toEqual(REFUSED)
    expect(await checkQuote(ws, chat, { replyToId: 42, start: null, end: null })).toEqual(REFUSED)
  })

  it('refuses a bad range', async () => {
    const { chat, replyId } = await chatWithReply()
    const len = Array.from(REPLY).length
    for (const [start, end] of [[3, 3], [5, 2], [-1, 4], [0, len + 1], [0, null], [null, 4], [0.5, 4], ['0', '4'], [undefined, undefined]]) {
      expect(await checkQuote(ws, chat, { replyToId: replyId, start, end }), `${start}..${end}`).toEqual(REFUSED)
    }
    expect(await checkQuote(ws, chat, { replyToId: replyId, start: 0, end: len })).toEqual({ ok: true, quote: { replyToId: replyId, start: 0, end: len } })
  })

  it('refuses something that is not an object', async () => {
    const { chat, replyId } = await chatWithReply()
    for (const raw of [replyId, 7, true, [replyId, null, null]]) {
      expect(await checkQuote(ws, chat, raw)).toEqual(REFUSED)
    }
  })

  it('refuses a message the request removes (an edit’s cut, including the edited message)', async () => {
    const { chat, askId, replyId } = await chatWithReply()
    const cut = [askId, replyId]
    expect(await checkQuote(ws, chat, { replyToId: replyId, start: null, end: null }, cut)).toEqual(REFUSED)
    expect(await checkQuote(ws, chat, { replyToId: askId, start: null, end: null }, cut)).toEqual(REFUSED)
    expect(await checkQuote(ws, chat, { replyToId: askId, start: null, end: null }, [replyId])).toEqual({ ok: true, quote: { replyToId: askId, start: null, end: null } })
  })

  it('writes nothing', async () => {
    const { chat, replyId } = await chatWithReply()
    await checkQuote(ws, chat, { replyToId: replyId, start: 0, end: 5 })
    expect(await (await getDb()).select().from(messages).where(eq(messages.sessionId, chat))).toHaveLength(2)
  })
})

describe('quotesForModel', () => {
  it('reads a highlighted part and a whole message, with the target’s role', async () => {
    const { chat, askId, replyId } = await chatWithReply()
    const part = await save({ workspaceId: ws, sessionId: chat, role: 'user', content: 'Why LRU?', quote: { replyToId: replyId, start: 6, end: 20 } })
    const whole = await save({ workspaceId: ws, sessionId: chat, role: 'user', content: 'Again?', quote: { replyToId: askId, start: null, end: null } })
    const plain = await save({ workspaceId: ws, sessionId: chat, role: 'user', content: 'Plain.' })

    const quotes = await quotesForModel(ws, chat, [askId, part, whole, plain, 'not-a-uuid'])
    expect(quotes).toEqual(new Map([
      [part, { kind: 'part', role: 'assistant', text: 'caches hot key' }],
      [whole, { kind: 'whole', role: 'user', text: ASK }],
    ]))
  })

  it('says deleted once the quoted turn is deleted', async () => {
    const { chat, replyId } = await chatWithReply()
    const id = await save({ workspaceId: ws, sessionId: chat, role: 'user', content: 'Why LRU?', quote: { replyToId: replyId, start: 6, end: 20 } })
    await deleteTurn(ws, chat, replyId)
    expect(await quotesForModel(ws, chat, [id])).toEqual(new Map([[id, { kind: 'deleted' }]]))
  })

  it('ignores ids from another chat', async () => {
    const { chat, replyId } = await chatWithReply()
    const id = await save({ workspaceId: ws, sessionId: chat, role: 'user', content: 'Why LRU?', quote: { replyToId: replyId, start: null, end: null } })
    const other = await newChat('Other')
    expect(await quotesForModel(ws, other, [id])).toEqual(new Map())
  })

  it('reads nothing for a chat of another workspace', async () => {
    const { chat, replyId } = await chatWithReply()
    const id = await save({ workspaceId: ws, sessionId: chat, role: 'user', content: 'Why LRU?', quote: { replyToId: replyId, start: null, end: null } })
    expect(await quotesForModel(newWorkspaceId(), chat, [id])).toEqual(new Map())
  })

  it('takes the message being sent from its checked quote, not from its saved row', async () => {
    const { chat, askId, replyId } = await chatWithReply()
    // An edit: the saved row still carries the old quote (or none).
    const edited = await save({ workspaceId: ws, sessionId: chat, role: 'user', content: 'old', quote: { replyToId: askId, start: null, end: null } })
    const sending = { id: edited, quote: { replyToId: replyId, start: 0, end: 5 } }
    expect(await quotesForModel(ws, chat, [edited], sending)).toEqual(new Map([[edited, { kind: 'part', role: 'assistant', text: 'Redis' }]]))
    expect(await quotesForModel(ws, chat, [edited], { id: edited, quote: null })).toEqual(new Map())
    // A new message whose id is not saved (yet) still gets its view.
    expect(await quotesForModel(ws, chat, ['browser-id'], { id: 'browser-id', quote: sending.quote }))
      .toEqual(new Map([['browser-id', { kind: 'part', role: 'assistant', text: 'Redis' }]]))
  })
})

describe('a quote sent with a message never reaches memory (Q16, Q17)', () => {
  // A word nothing else in this test says, in the reply being quoted.
  const RARE = 'Zymurgy'
  // Extraction reads "Zymurgy kettles" as a concept, so a leak would show.
  const QUOTED_REPLY = `Brewers use ${RARE} kettles for fermentation.`
  const TYPED = 'Tell me about Kafka partitions.'

  it('extraction, chat_pointers and retrieval see only the typed text', async () => {
    // A chat elsewhere that IS about the rare word, so retrieval could reach it.
    const elsewhere = await createChat(ws)
    const elsewhereId = await save({ workspaceId: ws, sessionId: elsewhere.id, role: 'user', content: QUOTED_REPLY })
    await ingestUserMessage({ workspaceId: ws, sessionId: elsewhere.id, messageId: elsewhereId, content: QUOTED_REPLY })

    const chat = await newChat('C')
    await save({ workspaceId: ws, sessionId: chat, role: 'user', content: 'What do brewers use?' })
    const replyId = await save({ workspaceId: ws, sessionId: chat, role: 'assistant', content: QUOTED_REPLY, modelUsed: 'test' })

    // What the browser sends: the quote rides in the last message's metadata.
    const last: UIMessage = {
      id: randomUUID(), role: 'user', metadata: { quote: { replyToId: replyId, start: null, end: null } },
      parts: [{ type: 'text', text: TYPED }],
    }

    // The route, step by step, for a new turn.
    const checked = await checkQuote(ws, chat, (last.metadata as { quote?: unknown }).quote ?? null)
    if (!checked.ok) throw new Error('quote refused')
    const draft = last.parts.flatMap((p) => (p.type === 'text' ? [p.text] : [])).join('')
    const memoryDraft = stripVisualize(draft)
    const messageId = await persistMessage({ workspaceId: ws, sessionId: chat, role: 'user', content: draft, id: last.id, quote: checked.quote })

    // The model DOES see the quote...
    const view = withQuotes([last], await quotesForModel(ws, chat, [last.id], { id: last.id, quote: checked.quote }))
    const modelText = view[0].parts.flatMap((p) => (p.type === 'text' ? [p.text] : [])).join('')
    expect(modelText).toContain(RARE)
    // ...but the message the route reads its draft from is untouched.
    expect(last.parts).toEqual([{ type: 'text', text: TYPED }])

    const { chats } = await retrieveContext({ workspaceId: ws, sessionId: chat, mode: 'explore', taggedChatIds: [], draftText: memoryDraft })
    expect(chats.map((c) => c.id)).not.toContain(elsewhere.id)
    // Control: the quoted text WOULD reach that chat, so the line above can fail.
    const leaked = await retrieveContext({ workspaceId: ws, sessionId: chat, mode: 'explore', taggedChatIds: [], draftText: modelText })
    expect(leaked.chats.map((c) => c.id)).toContain(elsewhere.id)

    const done = await finishTurn({
      workspaceId: ws, sessionId: chat, messageId, memoryDraft, text: 'Partitions keep order within a key.',
      modelId: 'test', assistantMessageId: randomUUID(), pointerShift: visualizePrefixLength(draft),
    })
    expect(done).not.toBeNull()

    const db = await getDb()
    expect((await db.select().from(messages).where(eq(messages.id, messageId)))[0].content).toBe(TYPED)
    const pointers = (await db.select({ t: chatPointers.matchText }).from(chatPointers).where(eq(chatPointers.messageId, messageId))).map((r) => r.t)
    expect(pointers.length).toBeGreaterThan(0)
    expect(pointers.join(' ').toLowerCase()).not.toContain(RARE.toLowerCase())
    const nodeIds = (await db.select({ n: messageNodes.nodeId }).from(messageNodes).where(eq(messageNodes.messageId, messageId))).map((r) => r.n)
    expect(nodeIds.length).toBeGreaterThan(0)
    const labels = (await db.select({ l: nodes.label }).from(nodes).where(inArray(nodes.id, nodeIds))).map((r) => r.l)
    expect(labels.join(' ').toLowerCase()).not.toContain(RARE.toLowerCase())
    expect(labels.join(' ').toLowerCase()).not.toContain('fermentation')
  })
})
