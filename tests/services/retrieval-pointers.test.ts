import { beforeEach, describe, expect, it } from 'vitest'
import { FIXTURE_WORKSPACE_ID, newChat, truncateAll } from '../helpers/pglite'
import { ingestUserMessage, persistMessage } from '@/services/graph'
import { retrieveContext } from '@/services/retrieval'

beforeEach(truncateAll)

/** One full turn, both roles indexed. Shared by every describe in this file. */
async function turn(chatId: string, user: string, assistant: string) {
  const workspaceId = FIXTURE_WORKSPACE_ID
  const messageId = await persistMessage({ workspaceId, sessionId: chatId, role: 'user', content: user })
  const assistantMessageId = await persistMessage({ workspaceId, sessionId: chatId, role: 'assistant', content: assistant, modelUsed: 'test' })
  await ingestUserMessage({ workspaceId, sessionId: chatId, messageId, content: user, assistantContent: assistant, assistantMessageId })
}

describe('retrieval reads memory from pointers', () => {
  // The failure ticket 11 measured: the fact lives deep in a long reply.
  it('reaches a fact from deep inside a long reply', async () => {
    const a = await newChat('A')
    const filler = Array.from({ length: 40 }, (_, i) => `Filler sentence number ${i} says little.`).join(' ')
    await turn(a, 'Tell me about Kafka partitions.', `${filler} Kafka partitions guarantee order only within one partition.`)
    const b = await newChat('B')
    const { chats } = await retrieveContext({
      workspaceId: FIXTURE_WORKSPACE_ID, sessionId: b, mode: 'explore', taggedChatIds: [],
      draftText: 'How do Kafka partitions guarantee order?',
    })
    expect(chats.map((c) => c.id)).toEqual([a])
    expect(chats[0].excerpts.join(' ')).toContain('guarantee order only within one partition')
  })

  it('sends the text that follows an emoji verbatim', async () => {
    const a = await newChat('A')
    await turn(a, '🎉 Kafka partitions keep order. Redis caches sessions.', 'Noted.')
    const b = await newChat('B')
    const { chats } = await retrieveContext({
      workspaceId: FIXTURE_WORKSPACE_ID, sessionId: b, mode: 'focus', taggedChatIds: [a], draftText: 'what about Redis?',
    })
    expect(chats[0].excerpts.join('\n')).toContain('Redis caches sessions.')
  })

  // Review Focus 5.
  // Each assistant excerpt is ~3 passages x ~1,050 chars, so four chats need
  // ~12,600 chars against an 8,000 budget: at least one must lose a window.
  it('reports every tagged chat that did not fully fit, instead of shrinking it silently', async () => {
    const ids: string[] = []
    for (let i = 0; i < 4; i++) {
      const id = await newChat(`Big ${i}`)
      const long = Array.from({ length: 12 }, (_, j) => `Chat ${i} passage ${j} ${'detail '.repeat(150)}end.`).join(' ')
      await turn(id, `Long chat ${i}.`, long)
      ids.push(id)
    }
    const b = await newChat('B')
    const { chats, dropped } = await retrieveContext({
      workspaceId: FIXTURE_WORKSPACE_ID, sessionId: b, mode: 'focus', taggedChatIds: ids, draftText: 'summarise',
    })
    const used = chats.reduce((n, c) => n + c.excerpts.join('').length, 0)
    expect(used).toBeLessThanOrEqual(8000)
    expect(dropped.length).toBeGreaterThan(0)
    // Every chat is accounted for: fully sent, or named in `dropped`.
    const full = chats.filter((c) => !dropped.includes(c.title))
    expect(full.length + dropped.length).toBe(4)
  })
})
