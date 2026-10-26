import { beforeEach, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { getDb } from '../../db'
import { truncateAll } from '../helpers/pglite'
import { createChat } from '@/services/dbApi'
import { ingestUserMessage, persistMessage } from '@/services/graph'
import { wordHits, wordQuery, wordSettings } from '@/services/retrieval'
import { newWorkspaceId } from '@/lib/workspace'

/**
 * Ticket 21: each per-word query of retrieval must read through the trigram
 * index ONCE. Planned as a walk over every chat, it asked the index again for
 * each chat: 2–3 s per word on a 308-chat workspace, even for a word that
 * matches nothing. This test asks Postgres for the plan and fails on that.
 */
beforeEach(truncateAll)
const WS = newWorkspaceId()

async function say(sessionId: string, user: string) {
  const messageId = await persistMessage({ workspaceId: WS, sessionId, role: 'user', content: user })
  await ingestUserMessage({ workspaceId: WS, sessionId, messageId, content: user })
}

async function seeded() {
  const kafka = (await createChat(WS)).id
  await say(kafka, 'Kafka partitions keep events in order within one partition.')
  const pg = (await createChat(WS)).id
  await say(pg, 'PostgreSQL uses a write-ahead log to make commits durable.')
  const probe = (await createChat(WS)).id
  await say(probe, 'The current chat also talks about partitions.')
  return { kafka, pg, probe }
}

async function plan(probe: string, word: string): Promise<string> {
  const db = await getDb()
  return db.transaction(async (tx) => {
    await wordSettings(tx)
    const res = (await tx.execute(sql`explain (costs off) ${wordQuery(WS, probe, word)}`)) as unknown as { rows: Record<string, string>[] }
    return res.rows.map((r) => Object.values(r)[0]).join('\n')
  })
}

describe('a per-word query reads through the trigram index once (ticket 21)', () => {
  it('is planned without scanning or walking every chat', async () => {
    const { probe } = await seeded()
    const text = await plan(probe, 'partitions')
    expect(text).not.toMatch(/Seq Scan on chat_pointers/)
    expect(text).not.toMatch(/idx_chat_pointers_session/)
    expect(text).toMatch(/idx_chat_pointers_match_trgm/)
  })

  it('finds the chats holding the word, never the current one', async () => {
    const { kafka, probe } = await seeded()
    const { chatsByWord, otherChats } = await wordHits(WS, probe, ['partitions', 'durable'])
    expect([...chatsByWord.get('partitions')!]).toEqual([kafka])
    expect(chatsByWord.get('partitions')!.has(probe)).toBe(false)
    expect(otherChats).toBe(2)
  })

  it('gives an empty set for a word nothing holds', async () => {
    const { probe } = await seeded()
    const { chatsByWord } = await wordHits(WS, probe, ['zebrafish'])
    expect(chatsByWord.get('zebrafish')!.size).toBe(0)
  })

  it('returns real Dates in meta, which ranking calls getTime() on', async () => {
    const { kafka, probe } = await seeded()
    const { meta } = await wordHits(WS, probe, ['partitions'])
    expect(meta.get(kafka)!.createdAt).toBeInstanceOf(Date)
    expect(meta.get(kafka)!.updatedAt).toBeInstanceOf(Date)
    expect(Number.isNaN(meta.get(kafka)!.updatedAt.getTime())).toBe(false)
  })

  it('leaves enable_seqscan on after it returns', async () => {
    const { probe } = await seeded()
    await wordHits(WS, probe, ['partitions'])
    const res = (await (await getDb()).execute(sql`show enable_seqscan`)) as unknown as { rows: { enable_seqscan: string }[] }
    expect(res.rows[0].enable_seqscan).toBe('on')
  })
})
