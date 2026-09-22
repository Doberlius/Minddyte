import { sql } from 'drizzle-orm'
import { getDb, sessions } from '../../db'

/**
 * Every table in the schema. Listed explicitly rather than discovered, so that
 * adding a table and forgetting to truncate it shows up as a test that pollutes
 * its neighbours rather than as silent cross-test leakage.
 */
const TABLES = [
  'cluster_origins',
  'collection_nodes',
  'collections',
  'forgotten',
  'graph_positions',
  'message_nodes',
  'messages',
  'nodes',
  'rejected_phrases',
  'session_nodes',
  'sessions',
] as const

/**
 * Reset between tests. CASCADE because of the foreign keys; RESTART IDENTITY so
 * any sequence starts over. Measured at 9.6 ms, against 1116 ms to rebuild the
 * instance — which is why this exists instead of a fresh database per test.
 */
export async function truncateAll(): Promise<void> {
  const db = await getDb()
  const list = TABLES.map((t) => `"${t}"`).join(', ')
  await db.execute(sql.raw(`truncate table ${list} restart identity cascade`))
}

/** A fixture is just a sessions row — ticket 03 removed users entirely. */
export async function newChat(title?: string): Promise<string> {
  const db = await getDb()
  const [row] = await db
    .insert(sessions)
    .values(title ? { title } : {})
    .returning({ id: sessions.id })
  return row.id
}

/** Assertions are numbers the DATABASE computed, never spies. This is how we read them. */
export async function countRows(table: string): Promise<number> {
  const db = await getDb()
  const res = await db.execute(sql.raw(`select count(*)::int as n from "${table}"`))
  const rows = (res as unknown as { rows: { n: number }[] }).rows
  return rows[0].n
}
