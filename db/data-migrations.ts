import { eq, sql } from 'drizzle-orm'
import type { Db } from './index'
import { chatPointers, dataMigrations, messages, sessions } from './schema'
import { describeSkip, pointerRows } from '../src/lib/pointers'

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]

export type DataMigration = { name: string; run: (tx: Tx) => Promise<void> }

/**
 * Steps that change DATA rather than schema, and so cannot be .sql files.
 * Append only. Never rename or reorder a step that has shipped: its name is
 * what records that it ran.
 */
export const DATA_MIGRATIONS: DataMigration[] = [
  { name: '0001_backfill_chat_pointers', run: backfillChatPointers },
]

/**
 * Run every step not yet recorded. Each step and its record commit in ONE
 * transaction, so a step is either fully done and recorded, or not done and
 * not recorded — never done twice, never half done. Ticket 05, Q6.
 */
export async function runDataMigrations(db: Db, list: DataMigration[] = DATA_MIGRATIONS): Promise<string[]> {
  const done = new Set((await db.select({ name: dataMigrations.name }).from(dataMigrations)).map((r) => r.name))
  const ran: string[] = []
  for (const step of list) {
    if (done.has(step.name)) continue
    await db.transaction(async (tx) => {
      await step.run(tx)
      await tx.insert(dataMigrations).values({ name: step.name })
    })
    ran.push(step.name)
  }
  return ran
}

/**
 * Pointers for every message written before pointers existed. Deterministic
 * from `messages.content`, so nothing is lost and nothing is guessed.
 */
async function backfillChatPointers(tx: Tx): Promise<void> {
  const pending = await tx
    .select({ id: messages.id, sessionId: messages.sessionId, workspaceId: sessions.workspaceId, content: messages.content })
    .from(messages)
    .innerJoin(sessions, eq(sessions.id, messages.sessionId))
    .where(sql`not exists (select 1 from ${chatPointers} where ${chatPointers.messageId} = ${messages.id})`)

  for (const m of pending) {
    const { rows, skipped } = pointerRows(m.content)
    if (rows.length > 0) {
      await tx
        .insert(chatPointers)
        .values(rows.map((r) => ({ ...r, workspaceId: m.workspaceId, sessionId: m.sessionId, messageId: m.id })))
        .onConflictDoNothing()
    }
    for (const s of skipped) console.warn(`[migrate] ${describeSkip(m.sessionId, m.id, s)}`)
  }
}
