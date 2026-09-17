import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import type { PGlite } from '@electric-sql/pglite'

const MIGRATIONS_DIR = path.join(process.cwd(), 'db', 'migrations')

/**
 * Drizzle separates the statements it generates with this marker. We execute
 * that same file rather than maintaining a parallel DDL script, because a
 * hand-kept copy drifts from the real schema and nothing notices until a query
 * fails in production. Ticket 06, decision 2.
 */
const BREAKPOINT = '--> statement-breakpoint'

export function migrationStatements(): string[] {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()
  if (files.length === 0) {
    throw new Error(
      `No .sql migration found in ${MIGRATIONS_DIR}. ` +
        'Generate one with `bunx drizzle-kit generate` before starting the app.',
    )
  }
  return files.flatMap((file) =>
    readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8')
      .split(BREAKPOINT)
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  )
}

/**
 * Ask the CATALOG, never the filesystem.
 *
 * Ticket 01 proved a data directory can exist while holding a half-initialised
 * database — a concurrent writer crashed partway through creating one. So "the
 * directory is there" is an inference, and `to_regclass` is the fact: it
 * returns null when the relation does not exist, and its oid when it does.
 */
export async function hasSchema(pg: PGlite): Promise<boolean> {
  const { rows } = await pg.query<{ reg: string | null }>(
    `select to_regclass('public.sessions') as reg`,
  )
  return rows[0]?.reg != null
}

export async function ensureSchema(pg: PGlite): Promise<'created' | 'present'> {
  if (await hasSchema(pg)) return 'present'
  for (const statement of migrationStatements()) {
    await pg.exec(statement)
  }
  return 'created'
}
