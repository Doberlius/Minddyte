import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { sql } from 'drizzle-orm'
import { getDb, sessions } from '../../db'
import { newWorkspaceId } from '@/lib/workspace'

/**
 * Every table in the schema. Listed explicitly rather than discovered, so that
 * adding a table and forgetting to truncate it shows up as a test that pollutes
 * its neighbours rather than as silent cross-test leakage.
 */
const TABLES = [
  'chat_pointers',
  'cluster_origins',
  'collection_nodes',
  'collections',
  'data_migrations',
  'forgotten',
  'graph_positions',
  'message_nodes',
  'messages',
  'nodes',
  'rejected_phrases',
  'session_nodes',
  'sessions',
  'user_core',
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

/**
 * One workspace, shared by every fixture chat this helper creates.
 *
 * `sessions.workspace_id` is NOT NULL, so a fixture needs a value from
 * somewhere. A single fixed id — not a fresh one per call — is what lets a
 * test's own helper (e.g. `turn(chatId, ...)` in graph.test.ts) pass the
 * same workspace it used to create the chat, without `newChat` having to
 * hand the id back. The one test that actually cross-checks two workspaces
 * (`isolation.test.ts`) mints its own with `newWorkspaceId()` and does not
 * use this helper.
 */
export const FIXTURE_WORKSPACE_ID = newWorkspaceId()

/** A fixture is just a sessions row — ticket 03 removed users entirely. */
export async function newChat(title?: string): Promise<string> {
  const db = await getDb()
  const [row] = await db
    .insert(sessions)
    .values({ workspaceId: FIXTURE_WORKSPACE_ID, ...(title ? { title } : {}) })
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

/** Builds the schema a pre-migrator database (e.g. the Render disk) holds: just 0000's statements. */
export function firstMigrationStatements(): string[] {
  const dir = path.join(process.cwd(), 'db', 'migrations')
  const [first] = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
  return readFileSync(path.join(dir, first), 'utf8')
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}
