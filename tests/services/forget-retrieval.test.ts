import { beforeEach, describe, expect, it } from 'vitest'
import { FIXTURE_WORKSPACE_ID as WS, newChat, truncateAll } from '../helpers/pglite'
import { ingestUserMessage, persistMessage } from '@/services/graph'
import { retrieveContext } from '@/services/retrieval'
import { forgetConcept } from '@/services/forget'
import { loadGraph } from '@/services/dbApi'

beforeEach(truncateAll)

async function turn(chatId: string, user: string, assistant: string) {
  const messageId = await persistMessage({ workspaceId: WS, sessionId: chatId, role: 'user', content: user })
  const assistantMessageId = await persistMessage({ workspaceId: WS, sessionId: chatId, role: 'assistant', content: assistant, modelUsed: 'test' })
  await ingestUserMessage({ workspaceId: WS, sessionId: chatId, messageId, content: user, assistantContent: assistant, assistantMessageId })
}

function ask(sessionId: string, draftText: string, taggedChatIds: string[] = []) {
  return retrieveContext({ workspaceId: WS, sessionId, mode: 'explore', taggedChatIds, draftText })
}

const text = (r: Awaited<ReturnType<typeof ask>>) => r.chats.flatMap((c) => c.excerpts.map((e) => e.text)).join(' ')

describe('retrieval never uses a forgotten sentence', () => {
  it('a chat reached only through forgotten sentences is no longer reached', async () => {
    const a = await newChat('A')
    await turn(a, 'Tell me about Kafka.', 'Kafka partitions guarantee order within a partition.')
    const b = await newChat('B')
    // Control: without forgetting, A IS reached, so the test below is not vacuous.
    expect((await ask(b, 'How do Kafka partitions guarantee order?')).chats.map((c) => c.id)).toEqual([a])

    await forgetConcept(WS, a, 'kafka')

    expect((await ask(b, 'How do Kafka partitions guarantee order?')).chats).toEqual([])
  })

  it('a chat tagged with @ and sent whole leaves out the forgotten sentences', async () => {
    const a = await newChat('A')
    await turn(a, 'We run Kafka and PostgreSQL in production.', 'PostgreSQL handles the writes. Kafka carries the events.')
    const b = await newChat('B')
    await forgetConcept(WS, a, 'kafka')

    const r = await ask(b, 'what did we decide?', [a])

    expect(text(r)).toContain('PostgreSQL handles the writes.')
    expect(text(r)).not.toMatch(/kafka/i)
  })

  // Review Focus 5: a forgotten sentence next to a picked passage must not come back as a neighbour.
  it('a forgotten sentence next to a picked passage is not added as context', async () => {
    const a = await newChat('A')
    await turn(a, 'Tell me about PostgreSQL and Kafka.', 'PostgreSQL stores rows. Kafka streams events. PostgreSQL replicates writes.')
    const b = await newChat('B')
    // Control: before forgetting, the Kafka sentence IS added as a neighbour.
    expect(text(await ask(b, 'How does PostgreSQL store rows?'))).toContain('Kafka streams events.')

    await forgetConcept(WS, a, 'kafka')

    const r = await ask(b, 'How does PostgreSQL store rows?')

    expect(r.chats.map((c) => c.id)).toEqual([a])
    expect(text(r)).toContain('PostgreSQL stores rows.')
    expect(text(r)).not.toContain('Kafka streams events.')
  })

  it("another chat's forgetting hides nothing here", async () => {
    const a = await newChat('A')
    await turn(a, 'We run Kafka and PostgreSQL in production.', 'Kafka carries the events.')
    const c = await newChat('C')
    await turn(c, 'Tell me about Kafka.', 'Kafka carries the events.')
    await forgetConcept(WS, a, 'kafka')
    const b = await newChat('B')

    expect(text(await ask(b, 'what about it?', [c]))).toContain('Kafka carries the events.')
  })
})

describe('the Archive passage count', () => {
  it('leaves out forgotten sentences', async () => {
    const a = await newChat('A')
    await turn(a, 'We run Kafka and PostgreSQL in production.', 'PostgreSQL handles the writes. Kafka carries the events.')
    expect((await loadGraph(WS)).chats.find((c) => c.id === a)?.passageCount).toBe(3)

    await forgetConcept(WS, a, 'kafka')

    expect((await loadGraph(WS)).chats.find((c) => c.id === a)?.passageCount).toBe(1)
  })
})
