import { beforeEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { getDb, messages } from '../../db'
import { FIXTURE_WORKSPACE_ID, newChat, truncateAll } from '../helpers/pglite'
import { persistMessage } from '@/services/graph'
import { handleChat } from '@/server/chat'

/**
 * Reply-to ticket 03, "Must hold": a quote that does not name a message of
 * this chat with a valid range is refused with a 400, and NOTHING is saved.
 * `checkQuote` writing nothing is tested on its own; this pins the ORDER in
 * the chat route itself, so the check can never slip behind a save.
 *
 * Every case here is refused before a model is chosen, so no model (and no
 * Ollama) is needed.
 */
beforeEach(truncateAll)
const ws = FIXTURE_WORKSPACE_ID

async function setup() {
  const chat = await newChat('C')
  const askId = await persistMessage({ workspaceId: ws, sessionId: chat, role: 'user', content: 'Tell me about Redis.' })
  const replyId = await persistMessage({ workspaceId: ws, sessionId: chat, role: 'assistant', content: 'Redis keeps data in memory.', modelUsed: 'test' })
  const other = await newChat('Other')
  const otherId = await persistMessage({ workspaceId: ws, sessionId: other, role: 'user', content: 'Something else.' })
  return { chat, askId, replyId, otherId }
}

const send = (body: unknown) =>
  handleChat(new Request('http://localhost/api/chat', { method: 'POST', body: JSON.stringify(body) }), ws)
const ask = (id: string, text: string, quote: unknown) => ({ id, role: 'user', parts: [{ type: 'text', text }], metadata: { quote } })
const rowsOf = async (chat: string) =>
  (await (await getDb()).select().from(messages).where(eq(messages.sessionId, chat))).map((m) => [m.id, m.content])

describe('the chat route refuses a bad quote before saving anything', () => {
  it('a new message quoting another chat, an unknown id, or past the end: 400 bad_quote, nothing saved', async () => {
    const { chat, replyId, otherId } = await setup()
    const before = await rowsOf(chat)
    for (const quote of [
      { replyToId: otherId, start: null, end: null },
      { replyToId: randomUUID(), start: null, end: null },
      { replyToId: replyId, start: 0, end: 999 },
    ]) {
      const id = randomUUID()
      const res = await send({ sessionId: chat, mode: 'explore', messages: [ask(id, 'Why?', quote)] })
      expect(res.status, JSON.stringify(quote)).toBe(400)
      expect((await res.json()).error).toBe('bad_quote')
      expect(await rowsOf(chat)).toEqual(before)
    }
  })

  it('an edit quoting another chat: 400 bad_quote, the message keeps its old text', async () => {
    const { chat, askId, replyId, otherId } = await setup()
    const before = await rowsOf(chat)
    const res = await send({
      sessionId: chat,
      mode: 'explore',
      trigger: 'submit-message',
      messageId: askId,
      expectCut: [askId, replyId],
      messages: [ask(askId, 'Tell me about Kafka.', { replyToId: otherId, start: null, end: null })],
    })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('bad_quote')
    expect(await rowsOf(chat)).toEqual(before)
  })
})
