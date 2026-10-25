import { beforeEach, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { getDb } from '../../db'
import { truncateAll } from '../helpers/pglite'
import { createChat } from '@/services/dbApi'
import { ingestUserMessage, persistMessage } from '@/services/graph'
import { stepThreeQuery, stepThreeSettings, wholeDraftHits } from '@/services/retrieval'
import { queryText, strongPhrases } from '@/lib/tokens'
import { newWorkspaceId } from '@/lib/workspace'

/**
 * Ticket 20, Q5: step 3 of retrieval must read through the trigram index.
 * Planned as a sequential scan it reads every passage of the workspace, once
 * per check: 8 s for a paragraph on the user's data, and 48 s once its filter
 * is in the plain (indexable) form, because the strict recheck then runs on
 * every passage. This test asks Postgres for the plan and fails on a scan.
 */
beforeEach(truncateAll)
const WS = newWorkspaceId()

async function say(sessionId: string, user: string) {
  const messageId = await persistMessage({ workspaceId: WS, sessionId, role: 'user', content: user })
  await ingestUserMessage({ workspaceId: WS, sessionId, messageId, content: user })
}

/** The two drafts ticket 20 measured. */
const PARAGRAPH = 'I have been thinking about how our event pipeline handles ordering when consumers fall behind. If we add more partitions to the topic, do we lose the ordering guarantees we rely on for account updates, and would it be better to key messages by account id so that every update for one account always lands in the same partition, even when we scale the consumer group out later?'
const SHORT = 'How do Kafka partitions keep order?'

async function seeded() {
  const other = (await createChat(WS)).id
  await say(other, 'Kafka partitions keep events in order within one partition.')
  await say(other, 'A consumer group shares the partitions of a topic between its members.')
  await say(other, 'PostgreSQL uses a write-ahead log to make commits durable.')
  return { probe: (await createChat(WS)).id }
}

async function plan(probe: string, draft: string): Promise<string> {
  const db = await getDb()
  const q = queryText(draft)
  return db.transaction(async (tx) => {
    await stepThreeSettings(tx)
    const res = (await tx.execute(sql`explain (costs off) ${stepThreeQuery(WS, probe, q, strongPhrases(q))}`)) as unknown as { rows: Record<string, string>[] }
    return res.rows.map((r) => Object.values(r)[0]).join('\n')
  })
}

describe('step 3 reads through the trigram index (ticket 20)', () => {
  for (const [name, draft] of [['a 370-character paragraph', PARAGRAPH], ['a short question', SHORT]] as const) {
    it(`plans ${name} without scanning every passage`, async () => {
      const { probe } = await seeded()
      const text = await plan(probe, draft)
      expect(text).not.toMatch(/Seq Scan on chat_pointers/)
      expect(text).toMatch(/idx_chat_pointers_match_trgm/)
    })
  }

  it('a one-word draft runs and returns a valid result', async () => {
    const { probe } = await seeded()
    const hits = await wholeDraftHits(WS, probe, 'partitions')
    expect(Array.isArray(hits)).toBe(true)
    for (const h of hits) expect(h).toMatchObject({ strong: 0, phrase: null })
  })

  it('leaves enable_seqscan on after it returns', async () => {
    const { probe } = await seeded()
    await wholeDraftHits(WS, probe, queryText(PARAGRAPH))
    const db = await getDb()
    const res = (await db.execute(sql`show enable_seqscan`)) as unknown as { rows: { enable_seqscan: string }[] }
    expect(res.rows[0].enable_seqscan).toBe('on')
  })
})
