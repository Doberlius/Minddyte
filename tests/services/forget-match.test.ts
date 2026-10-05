import { beforeEach, describe, expect, it } from 'vitest'
import { truncateAll } from '../helpers/pglite'
import { createChat } from '@/services/dbApi'
import { ingestUserMessage, persistMessage } from '@/services/graph'
import { conceptsMentioned, forgetConcept } from '@/services/forget'
import { newWorkspaceId } from '@/lib/workspace'

beforeEach(truncateAll)

const WS = newWorkspaceId()

/** One real turn through the real ingest path. */
async function say(sessionId: string, user: string) {
  const messageId = await persistMessage({ workspaceId: WS, sessionId, role: 'user', content: user })
  await ingestUserMessage({ workspaceId: WS, sessionId, messageId, content: user })
}

const labels = (found: { key: string; label: string }[]) => found.map((c) => c.label)

describe('conceptsMentioned (Q26: the concepts INSIDE a highlight)', () => {
  it('returns the concept the text mentions', async () => {
    const chat = (await createChat(WS)).id
    await say(chat, 'We run Kafka partitions and PostgreSQL and Redis in production.')

    const found = await conceptsMentioned(WS, chat, 'we use PostgreSQL here')

    expect(found).toEqual([{ key: 'postgresql', label: 'PostgreSQL' }])
  })

  it('returns two concepts A to Z by label', async () => {
    const chat = (await createChat(WS)).id
    await say(chat, 'We run Kafka partitions and PostgreSQL and Redis in production.')

    const found = await conceptsMentioned(WS, chat, 'Redis sits next to PostgreSQL')

    expect(labels(found)).toEqual(['PostgreSQL', 'Redis'])
  })

  it('returns nothing when the text mentions no concept', async () => {
    const chat = (await createChat(WS)).id
    await say(chat, 'We run Kafka partitions and PostgreSQL and Redis in production.')

    expect(await conceptsMentioned(WS, chat, 'nothing relevant at all')).toEqual([])
  })

  it('does not offer "Kafka partitions" for the highlight "Kafka"', async () => {
    const chat = (await createChat(WS)).id
    await say(chat, 'We run Kafka partitions and PostgreSQL and Redis in production.')
    // The chat really holds the longer name, or this test proves nothing.
    expect(labels(await conceptsMentioned(WS, chat, 'Kafka partitions'))).toContain('Kafka partitions')

    expect(labels(await conceptsMentioned(WS, chat, 'Kafka'))).not.toContain('Kafka partitions')
    expect(await conceptsMentioned(WS, chat, 'Kafka')).toEqual([])
  })

  it('does not return a concept forgotten in this chat', async () => {
    const chat = (await createChat(WS)).id
    await say(chat, 'We run Kafka partitions and PostgreSQL and Redis in production.')
    expect(await forgetConcept(WS, chat, 'redis')).toBe(true)

    expect(labels(await conceptsMentioned(WS, chat, 'Redis sits next to PostgreSQL'))).toEqual(['PostgreSQL'])
  })

  it("does not return another chat's concepts", async () => {
    const mine = (await createChat(WS)).id
    const other = (await createChat(WS)).id
    await say(mine, 'We run PostgreSQL in production.')
    await say(other, 'We run Redis in production.')

    expect(labels(await conceptsMentioned(WS, mine, 'Redis sits next to PostgreSQL'))).toEqual(['PostgreSQL'])
  })

  it("does not return another workspace's chat", async () => {
    const chat = (await createChat(WS)).id
    await say(chat, 'We run PostgreSQL in production.')

    expect(await conceptsMentioned(newWorkspaceId(), chat, 'PostgreSQL')).toEqual([])
  })
})
