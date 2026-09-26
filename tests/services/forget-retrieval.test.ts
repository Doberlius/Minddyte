import { beforeEach, describe, expect, it } from 'vitest'
import { getDb, chatPointers, forgotten, messages } from '../../db'
import { FIXTURE_WORKSPACE_ID as WS, newChat, truncateAll } from '../helpers/pglite'
import { ingestUserMessage, persistMessage } from '@/services/graph'
import { retrieveContext } from '@/services/retrieval'
import { forgetConcept } from '@/services/forget'
import { loadGraph } from '@/services/dbApi'
import { HIDDEN_TITLE } from '@/lib/prompt'

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

describe('forgetting never freezes a read (final review, fix 1)', () => {
  // A passage used to be reduced to words once per (passage, forgotten label)
  // pair. Ticket 15's giant message, split into 206 chunks of 4,000 chars,
  // with 20 labels forgotten: 1,600 ms per read before, about 125 ms after.
  it('a giant chat with many forgotten concepts is counted quickly', async () => {
    const a = await newChat('A')
    const vocab = ['queue', 'topic', 'broker', 'offset', 'replica', 'leader', 'segment', 'commit']
    const chunk = (k: number) => Array.from({ length: 700 }, (_, i) => vocab[(i + k) % vocab.length]).join(' ').slice(0, 3990) + (k === 0 ? ' kafka' : ' .....')
    const chunks = Array.from({ length: 206 }, (_, k) => chunk(k))
    const content = chunks.join(' ')
    const [m] = await (await getDb()).insert(messages).values({ sessionId: a, role: 'user', content }).returning({ id: messages.id })
    let at = 0
    await (await getDb()).insert(chatPointers).values(
      chunks.map((c, ordinal) => {
        const row = { workspaceId: WS, sessionId: a, messageId: m.id, ordinal, kind: 'sentence' as const, startChar: at, endChar: at + c.length, matchText: c }
        at += c.length + 1
        return row
      }),
    )
    await (await getDb()).insert(forgotten).values(
      ['Kafka', ...Array.from({ length: 19 }, (_, k) => `Unrelated Concept ${k}`)].map((nodeLabel) => ({ sessionId: a, nodeLabel })),
    )

    const t = Date.now()
    const graph = await loadGraph(WS)
    const ms = Date.now() - t

    expect(graph.chats.find((c) => c.id === a)?.passageCount).toBe(205) // the kafka chunk is hidden
    expect(ms).toBeLessThan(1000)
  }, 120_000)
})

describe('a title that mentions a forgotten concept (ticket 10, F2/F4/F5)', () => {
  it('is replaced by a neutral heading for the model', async () => {
    const a = await newChat('A')
    await turn(a, 'We run Kafka and PostgreSQL in production.', 'PostgreSQL handles the writes. Kafka carries the events.')
    const b = await newChat('B')
    // Control: before forgetting, the real title is sent.
    expect((await ask(b, 'what did we decide?', [a])).chats.map((c) => c.title)).toEqual(['We run Kafka and PostgreSQL in production'])

    await forgetConcept(WS, a, 'kafka')

    expect((await ask(b, 'what did we decide?', [a])).chats.map((c) => c.title)).toEqual([HIDDEN_TITLE])
  })

  // A chat's first message always becomes its title (deriveTitle, in
  // ingestUserMessage), whatever newChat() was given. So these tests choose
  // their titles through the first message.
  it('stays when the title does not mention the forgotten concept', async () => {
    const a = await newChat('A')
    await turn(a, 'PostgreSQL handles our storage.', 'Good choice.')
    await turn(a, 'We also run Kafka.', 'Kafka carries the events.')
    const b = await newChat('B')
    await forgetConcept(WS, a, 'kafka')

    expect((await ask(b, 'what did we decide?', [a])).chats.map((c) => c.title)).toEqual(['PostgreSQL handles our storage'])
  })

  // Review Focus 3.
  it("another chat's forgotten concept leaves this title alone", async () => {
    const a = await newChat('A')
    await turn(a, 'Tell me about Kafka.', 'Kafka carries the events.')
    const c = await newChat('C')
    await turn(c, 'Tell me about Kafka.', 'Kafka carries the events.')
    await forgetConcept(WS, c, 'kafka')
    const b = await newChat('B')

    expect((await ask(b, 'what about it?', [a])).chats.map((x) => x.title)).toEqual(['Tell me about Kafka'])
  })
})
