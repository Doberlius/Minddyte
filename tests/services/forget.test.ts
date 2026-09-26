import { beforeEach, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { getDb, chatPointers, messages, nodes, sessions, sessionNodes, forgotten } from '../../db'
import { countRows, truncateAll } from '../helpers/pglite'
import { createChat } from '@/services/dbApi'
import { ingestUserMessage, persistMessage } from '@/services/graph'
import { PREVIEW_CAP, PartsChangedError, forgetConcept, forgetPreview } from '@/services/forget'
import { newWorkspaceId } from '@/lib/workspace'

beforeEach(truncateAll)

const WS = newWorkspaceId()

/** One real turn through the real ingest path; the assistant reply is optional. */
async function say(sessionId: string, user: string, assistant?: string) {
  const messageId = await persistMessage({ workspaceId: WS, sessionId, role: 'user', content: user })
  const assistantMessageId = assistant
    ? await persistMessage({ workspaceId: WS, sessionId, role: 'assistant', content: assistant, modelUsed: 'test' })
    : undefined
  await ingestUserMessage({ workspaceId: WS, sessionId, messageId, content: user, assistantContent: assistant, assistantMessageId })
}

async function keysOf(sessionId: string): Promise<string[]> {
  const db = await getDb()
  const rows = await db
    .select({ key: nodes.canonicalKey })
    .from(sessionNodes)
    .innerJoin(nodes, eq(nodes.id, sessionNodes.nodeId))
    .where(eq(sessionNodes.sessionId, sessionId))
  return rows.map((r) => r.key).sort()
}

async function node(key: string) {
  const db = await getDb()
  return db.query.nodes.findFirst({ where: and(eq(nodes.canonicalKey, key), eq(nodes.workspaceId, WS)) })
}

async function headlineKey(sessionId: string): Promise<string | null> {
  const db = await getDb()
  const [chat] = await db.select({ id: sessions.headlineNodeId }).from(sessions).where(eq(sessions.id, sessionId))
  if (!chat?.id) return null
  const n = await db.query.nodes.findFirst({ where: eq(nodes.id, chat.id) })
  return n?.canonicalKey ?? null
}

describe('forgetConcept', () => {
  it('unlinks the concept from that chat only, and recounts a shared one', async () => {
    const a = (await createChat(WS)).id
    const b = (await createChat(WS)).id
    await say(a, 'We run Kafka and PostgreSQL in production.')
    await say(b, 'Tell me about Kafka.')
    expect((await node('kafka'))?.chatCount).toBe(2)

    expect(await forgetConcept(WS, a, 'kafka')).toBe(true)

    expect(await keysOf(a)).toEqual(['postgresql'])
    expect(await keysOf(b)).toEqual(['kafka'])
    expect((await node('kafka'))?.chatCount).toBe(1)
  })

  it('deletes a concept no chat holds any more', async () => {
    const a = (await createChat(WS)).id
    await say(a, 'We run Kafka and PostgreSQL in production.')

    await forgetConcept(WS, a, 'kafka')

    expect(await node('kafka')).toBeUndefined()
    expect((await node('postgresql'))?.chatCount).toBe(1)
  })

  it('records the forgotten label for that chat, and keeps every message', async () => {
    const a = (await createChat(WS)).id
    await say(a, 'We run Kafka and PostgreSQL in production.', 'Kafka carries the events.')
    expect(await countRows('messages')).toBe(2)

    await forgetConcept(WS, a, 'kafka')

    const db = await getDb()
    expect(await db.select({ label: forgotten.nodeLabel }).from(forgotten).where(eq(forgotten.sessionId, a))).toEqual([
      { label: 'Kafka' },
    ])
    expect(await countRows('messages')).toBe(2)
  })

  it('moves the headline to the next concept from the first message', async () => {
    const a = (await createChat(WS)).id
    await say(a, 'We run Kafka and PostgreSQL in production.')
    expect(await headlineKey(a)).toBe('kafka')

    await forgetConcept(WS, a, 'kafka')

    expect(await headlineKey(a)).toBe('postgresql')
  })

  // Review Focus 1.
  it('clears the headline when no concept is left', async () => {
    const a = (await createChat(WS)).id
    await say(a, 'Tell me about Kafka.')

    await forgetConcept(WS, a, 'kafka')

    expect(await headlineKey(a)).toBeNull()
  })

  // Review Focus 3.
  it('a second forget of the same concept is "not found" and changes nothing', async () => {
    const a = (await createChat(WS)).id
    await say(a, 'We run Kafka and PostgreSQL in production.')
    await forgetConcept(WS, a, 'kafka')

    expect(await forgetConcept(WS, a, 'kafka')).toBe(false)
    expect(await countRows('forgotten')).toBe(1)
    expect(await keysOf(a)).toEqual(['postgresql'])
  })

  // Review Focus 4.
  it("another workspace's chat is 'not found', and nothing changes", async () => {
    const a = (await createChat(WS)).id
    await say(a, 'We run Kafka and PostgreSQL in production.')

    expect(await forgetConcept(newWorkspaceId(), a, 'kafka')).toBe(false)
    expect(await forgetPreview(newWorkspaceId(), a, 'kafka')).toBeNull()
    expect(await keysOf(a)).toEqual(['kafka', 'postgresql'])
    expect(await countRows('forgotten')).toBe(0)
  })
})

describe('forgetPreview', () => {
  it('lists the sentences of BOTH roles that mention the concept, whole words only', async () => {
    const a = (await createChat(WS)).id
    await say(
      a,
      'We run Kafka and PostgreSQL in production.',
      "PostgreSQL handles the writes. KAFKA's partitions carry the events. The Kafkaesque process is slow.",
    )

    const p = await forgetPreview(WS, a, 'kafka')

    expect(p).toEqual({
      label: 'Kafka',
      total: 2,
      sentences: ['We run Kafka and PostgreSQL in production.', "KAFKA's partitions carry the events."],
      otherChats: 0,
      titleMentions: true,
      parts: [],
    })
  })

  it('says whether the chat’s title mentions the concept', async () => {
    const a = (await createChat(WS)).id
    await say(a, 'PostgreSQL handles our storage.') // becomes the title
    await say(a, 'We also run Kafka.')

    expect((await forgetPreview(WS, a, 'postgresql'))?.titleMentions).toBe(true)
    expect((await forgetPreview(WS, a, 'kafka'))?.titleMentions).toBe(false)
  })

  // Review Focus 2: dots are not wildcards, and a label with punctuation still matches.
  it('matches a dotted label literally', async () => {
    const a = (await createChat(WS)).id
    await say(a, 'Set max.poll.records carefully.', 'Raise max.poll.records slowly. Keep maxXpollXrecords out of it.')

    const p = await forgetPreview(WS, a, 'maxpollrecords')

    expect(p?.sentences).toEqual(['Set max.poll.records carefully.', 'Raise max.poll.records slowly.'])
  })

  it('counts the other chats that keep the concept', async () => {
    const a = (await createChat(WS)).id
    const b = (await createChat(WS)).id
    await say(a, 'We run Kafka and PostgreSQL in production.')
    await say(b, 'Tell me about Kafka.')

    expect((await forgetPreview(WS, a, 'kafka'))?.otherChats).toBe(1)
  })

  it('is null for a concept the chat does not hold', async () => {
    const a = (await createChat(WS)).id
    await say(a, 'We run Kafka and PostgreSQL in production.')
    expect(await forgetPreview(WS, a, 'redis')).toBeNull()
  })

  // Final review, fix 3: a sentence an earlier forget already hides is not "newly hidden".
  it('leaves out sentences an earlier forget in this chat already hides', async () => {
    const a = (await createChat(WS)).id
    await say(a, 'We run Kafka and PostgreSQL in production.', 'PostgreSQL handles the writes. Kafka carries the events.')
    await forgetConcept(WS, a, 'kafka')

    const p = await forgetPreview(WS, a, 'postgresql')

    expect(p?.total).toBe(1)
    expect(p?.sentences).toEqual(['PostgreSQL handles the writes.'])
  })
})

describe('after forgetting', () => {
  it('a later message in the same chat never re-links the concept', async () => {
    const a = (await createChat(WS)).id
    await say(a, 'We run Kafka and PostgreSQL in production.')
    await forgetConcept(WS, a, 'kafka')

    await say(a, 'Kafka again, with PostgreSQL.')

    expect(await keysOf(a)).toEqual(['postgresql'])
    expect(await node('kafka')).toBeUndefined()
  })

  it('another chat can still hold the concept', async () => {
    const a = (await createChat(WS)).id
    await say(a, 'We run Kafka and PostgreSQL in production.')
    await forgetConcept(WS, a, 'kafka')

    const b = (await createChat(WS)).id
    await say(b, 'Tell me about Kafka.')

    expect(await keysOf(b)).toEqual(['kafka'])
    expect((await node('kafka'))?.chatCount).toBe(1)
  })
})

describe('parts of a name (ticket 10, F9–F12)', () => {
  it('offers a part that some sentences mention on their own, and not one they never do', async () => {
    const a = (await createChat(WS)).id
    await say(a, 'Tell me about Steve Jobs.', 'Steve Jobs founded Apple. Jobs’s vision shaped it. Tim Cook followed him.')

    const p = await forgetPreview(WS, a, 'stevejobs')

    expect(p?.total).toBe(2)
    // Review Focus 4: "Steve" appears only inside "Steve Jobs", so it is not offered.
    expect(p?.parts).toEqual([{ word: 'Jobs', total: 1, sentences: ['Jobs’s vision shaped it.'], alsoConcept: false, partOf: [], titleMentions: true }])
  })

  it('forgets the ticked parts in that chat, and nothing else', async () => {
    const a = (await createChat(WS)).id
    await say(a, 'Tell me about Steve Jobs.', 'Steve Jobs founded Apple. Jobs’s vision shaped it. Tim Cook followed him.')

    expect(await forgetConcept(WS, a, 'stevejobs', ['jobs'])).toBe(true)

    const db = await getDb()
    const rows = await db.select({ label: forgotten.nodeLabel }).from(forgotten).where(eq(forgotten.sessionId, a))
    expect(rows.map((r) => r.label).sort()).toEqual(['Jobs', 'Steve Jobs'])
  })

  // Review Focus 2.
  it('ignores parts the name does not contain', async () => {
    const a = (await createChat(WS)).id
    await say(a, 'Tell me about Steve Jobs.', 'Steve Jobs founded Apple.')

    await forgetConcept(WS, a, 'stevejobs', ['Apple', 'nonsense'])

    expect(await countRows('forgotten')).toBe(1)
  })

  // Review Focus 1, F14: one forget never removes another concept.
  it('a part that is its own concept is flagged, and never forgotten through this concept', async () => {
    const a = (await createChat(WS)).id
    await say(a, 'Kafka partitions keep order, and we run Kafka in production.', 'Kafka is fast.')
    expect(await keysOf(a)).toEqual(['kafka', 'kafkapartitions'])

    const p = await forgetPreview(WS, a, 'kafkapartitions')
    expect(p?.parts).toEqual([{ word: 'Kafka', total: 1, sentences: ['Kafka is fast.'], alsoConcept: true, partOf: [], titleMentions: true }])

    // Even a request that sends it anyway: refused, and nothing changes (final review, item 3).
    const headline = await headlineKey(a)
    await expect(forgetConcept(WS, a, 'kafkapartitions', ['Kafka'])).rejects.toBeInstanceOf(PartsChangedError)

    expect(await keysOf(a)).toEqual(['kafka', 'kafkapartitions'])
    expect((await node('kafka'))?.chatCount).toBe(1)
    expect(await headlineKey(a)).toBe(headline)
    expect(await countRows('forgotten')).toBe(0)
  })

  // Final review, item 1, F15: a ticked "Steve" would hide every "Steve Wozniak" sentence.
  it('a part that is a word of another concept’s name is flagged, and never forgotten through this concept', async () => {
    const a = (await createChat(WS)).id
    await say(a, 'Steve Jobs and Steve Wozniak built Apple.', 'Steve Wozniak designed the board. Steve kept it simple. Jobs sold it.')
    expect(await keysOf(a)).toEqual(['apple', 'stevejobs', 'stevewozniak'])

    const p = await forgetPreview(WS, a, 'stevejobs')
    expect(p?.parts).toEqual([
      {
        word: 'Steve',
        total: 2,
        sentences: ['Steve Wozniak designed the board.', 'Steve kept it simple.'],
        alsoConcept: false,
        partOf: ['Steve Wozniak'],
        titleMentions: true,
      },
      { word: 'Jobs', total: 1, sentences: ['Jobs sold it.'], alsoConcept: false, partOf: [], titleMentions: true },
    ])

    // A request that ticks it anyway is refused whole: nothing is forgotten.
    await expect(forgetConcept(WS, a, 'stevejobs', ['Steve', 'Jobs'])).rejects.toBeInstanceOf(PartsChangedError)
    expect(await countRows('forgotten')).toBe(0)
    expect(await keysOf(a)).toEqual(['apple', 'stevejobs', 'stevewozniak'])

    // Without it, the rest goes through.
    expect(await forgetConcept(WS, a, 'stevejobs', ['Jobs'])).toBe(true)
    const db = await getDb()
    const rows = await db.select({ label: forgotten.nodeLabel }).from(forgotten).where(eq(forgotten.sessionId, a))
    expect(rows.map((r) => r.label).sort()).toEqual(['Jobs', 'Steve Jobs'])
    expect(await keysOf(a)).toEqual(['apple', 'stevewozniak'])
  })

  // Final review, item 3: "Jobs" became a concept (in another tab, say)
  // after the modal offered it. The ticked request must change nothing.
  it('a part refused after the preview offered it changes nothing', async () => {
    const a = (await createChat(WS)).id
    await say(a, 'Tell me about Steve Jobs.', 'Steve Jobs founded Apple. Jobs’s vision shaped it. Tim Cook followed him.')
    expect((await forgetPreview(WS, a, 'stevejobs'))?.parts.map((x) => x.word)).toEqual(['Jobs'])
    const db = await getDb()
    const [jobs] = await db.insert(nodes).values({ workspaceId: WS, label: 'Jobs', canonicalKey: 'jobs', chatCount: 1 }).returning({ id: nodes.id })
    await db.insert(sessionNodes).values({ sessionId: a, nodeId: jobs.id })
    const headline = await headlineKey(a)

    await expect(forgetConcept(WS, a, 'stevejobs', ['jobs'])).rejects.toBeInstanceOf(PartsChangedError)

    expect(await countRows('forgotten')).toBe(0)
    expect(await keysOf(a)).toEqual(['jobs', 'stevejobs'])
    expect((await node('stevejobs'))?.chatCount).toBe(1)
    expect(await headlineKey(a)).toBe(headline)
  })

  it('names every other concept a part is a word of', async () => {
    const a = (await createChat(WS)).id
    await say(a, 'We use Kafka Streams and Kafka Connect.', 'Kafka Connect moves data. Kafka is fast. Streams process it.')
    expect(await keysOf(a)).toEqual(['kafkaconnect', 'kafkastreams'])

    const p = await forgetPreview(WS, a, 'kafkastreams')

    expect(p?.parts.map((x) => [x.word, x.alsoConcept, x.partOf])).toEqual([
      ['Kafka', false, ['Kafka Connect']],
      ['Streams', false, []],
    ])
  })
})

/** A concept linked to the chat directly, and passages written directly, for the tests below. */
async function seed(sessionId: string, label: string, key: string, passages: string[]) {
  const db = await getDb()
  const content = passages.join(' ')
  const [m] = await db.insert(messages).values({ sessionId, role: 'user', content }).returning({ id: messages.id })
  let at = 0
  await db.insert(chatPointers).values(
    passages.map((text, ordinal) => {
      const row = { workspaceId: WS, sessionId, messageId: m.id, ordinal, kind: 'sentence' as const, startChar: at, endChar: at + text.length, matchText: text }
      at += text.length + 1
      return row
    }),
  )
  const [n] = await db.insert(nodes).values({ workspaceId: WS, label, canonicalKey: key, chatCount: 1 }).returning({ id: nodes.id })
  await db.insert(sessionNodes).values({ sessionId, nodeId: n.id })
}

describe('a part in the chat’s title (final review, item 4)', () => {
  it('says whether the title mentions each part', async () => {
    const a = (await createChat(WS)).id
    await (await getDb()).update(sessions).set({ title: 'What Jobs said' }).where(eq(sessions.id, a))
    await seed(a, 'Steve Jobs', 'stevejobs', ['Steve Jobs spoke.', 'Jobs waved.', 'Steve smiled.'])

    const p = await forgetPreview(WS, a, 'stevejobs')

    expect(p?.titleMentions).toBe(false)
    expect(p?.parts.map((x) => [x.word, x.titleMentions])).toEqual([
      ['Steve', false],
      ['Jobs', true],
    ])
  })
})

describe('the preview in one pass (final review, item 2)', () => {
  it('caps each list at PREVIEW_CAP, in the order said, and still counts them all', async () => {
    const a = (await createChat(WS)).id
    const said = [
      ...Array.from({ length: PREVIEW_CAP + 1 }, (_, i) => `Jobs said thing ${i}.`),
      'Steve Jobs spoke.',
      'Steve waved.',
    ]
    await seed(a, 'Steve Jobs', 'stevejobs', said)

    const p = await forgetPreview(WS, a, 'stevejobs')

    expect(p?.total).toBe(1)
    expect(p?.sentences).toEqual(['Steve Jobs spoke.'])
    expect(p?.parts.map((x) => [x.word, x.total, x.sentences.length])).toEqual([
      ['Steve', 1, 1],
      ['Jobs', PREVIEW_CAP + 1, PREVIEW_CAP],
    ])
    expect(p?.parts[1].sentences.slice(0, 2)).toEqual(['Jobs said thing 0.', 'Jobs said thing 1.'])
    expect(p?.parts[1].sentences.at(-1)).toBe(`Jobs said thing ${PREVIEW_CAP - 1}.`)
  })

  // Each part used to scan the chat twice on its own, reducing every
  // passage to words and cutting its text out of the message each time, on
  // the one connection every visitor shares. Ticket 15's giant message (206
  // chunks of 4,000 chars) with a four-word name: about 6,500 ms before,
  // about 1,100 ms after (most of it substring() walking the 800 KB message
  // to each offset, once per passage now instead of once per part).
  it('a giant chat with a four-word name is previewed quickly', async () => {
    const a = (await createChat(WS)).id
    const vocab = ['queue', 'topic', 'broker', 'offset', 'replica', 'leader', 'segment', 'commit', 'kafka', 'streams', 'connect', 'sink']
    const chunk = (k: number) => Array.from({ length: 700 }, (_, i) => vocab[(i * 7 + k) % vocab.length]).join(' ').slice(0, 3990) + ' .....'
    await seed(a, 'Kafka Streams Connect Sink', 'kafkastreamsconnectsink', Array.from({ length: 206 }, (_, k) => chunk(k)))

    const t = Date.now()
    const p = await forgetPreview(WS, a, 'kafkastreamsconnectsink')
    const ms = Date.now() - t

    expect(p?.total).toBe(0)
    expect(p?.parts.map((x) => [x.word, x.total])).toEqual([
      ['Kafka', 206],
      ['Streams', 206],
      ['Connect', 206],
      ['Sink', 206],
    ])
    expect(ms).toBeLessThan(3000)
  }, 120_000)
})
