import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import type { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { readMigrationFiles } from 'drizzle-orm/migrator'

const MIGRATIONS_DIR = path.join(process.cwd(), 'db', 'migrations')

/**
 * Drizzle separates the statements it generates with this marker. We execute
 * that same file rather than maintaining a parallel DDL script, because a
 * hand-kept copy drifts from the real schema and nothing notices until a query
 * fails in production. Ticket 06, decision 2.
 */
const BREAKPOINT = '--> statement-breakpoint'

export function migrationStatements(): string[] {
  let entries: string[]
  try {
    entries = readdirSync(MIGRATIONS_DIR)
  } catch (err) {
    // A missing directory and an empty one are different mistakes and need
    // different fixes, so they must not share a message. This one is what a
    // deployment hits: the migrations are data, not code, so a bundler never
    // sees them and an image that ships only the build output leaves the app
    // unable to create its own schema — as a bare ENOENT deep in a 500.
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    throw new Error(
      `No migrations directory at ${MIGRATIONS_DIR}, so the schema cannot be created.\n` +
        'Running from the project root? This path is resolved from the working\n' +
        'directory. Packaging the app? db/migrations has to be copied alongside\n' +
        'the build output — it is read at runtime, not bundled.',
    )
  }

  const files = entries.filter((f) => f.endsWith('.sql')).sort()
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

/**
 * Bring any database up to the current schema, without ever wiping it.
 *
 * Until 2026-09-23 a schema change meant deleting the database (local-first
 * ticket 02). That stopped being acceptable once the app was deployed with
 * visitors' chats on a persistent disk. Drizzle's migrator now records every
 * migration it applies in `drizzle.__drizzle_migrations` and applies only
 * the ones not recorded yet.
 *
 * Three starting points:
 *   empty      a new database — every migration runs
 *   untracked  created by the OLD bootstrap, which ran 0000 and recorded
 *              nothing. Marked as having 0000, then the rest run.
 *   tracked    already managed by the migrator — only new migrations run
 */
export async function ensureSchema(
  pg: PGlite,
): Promise<{ start: 'empty' | 'untracked' | 'tracked'; applied: number }> {
  // Called for its friendly errors about a missing or empty migrations
  // folder — the migrator's own message ("Can't find meta/_journal.json")
  // tells a deployer nothing about what to copy.
  migrationStatements()

  const hadSchema = await hasSchema(pg)
  const tracked = await isTracked(pg)
  const start = !hadSchema ? 'empty' : tracked ? 'tracked' : 'untracked'

  if (start === 'untracked') await markAsHaving0000(pg)
  const before = start === 'empty' ? 0 : await recordedCount(pg)

  await migrate(drizzle(pg), { migrationsFolder: MIGRATIONS_DIR })

  return { start, applied: (await recordedCount(pg)) - before }
}

async function isTracked(pg: PGlite): Promise<boolean> {
  const { rows } = await pg.query<{ reg: string | null }>(
    `select to_regclass('drizzle.__drizzle_migrations') as reg`,
  )
  return rows[0]?.reg != null
}

async function recordedCount(pg: PGlite): Promise<number> {
  const { rows } = await pg.query<{ n: number }>(
    `select count(*)::int as n from drizzle.__drizzle_migrations`,
  )
  return rows[0].n
}

/**
 * Record 0000 as applied WITHOUT running it, exactly as the migrator itself
 * would have recorded it: same hash, same timestamp, taken from the same
 * reader (`readMigrationFiles`), so the migrator sees no difference.
 *
 * Only safe if the database really is 0000. The one migration that ever
 * existed before this created `sessions.workspace_id`, so a database without
 * that column predates it and is refused rather than guessed at.
 */
async function markAsHaving0000(pg: PGlite): Promise<void> {
  const { rows } = await pg.query<{ n: number }>(
    `select count(*)::int as n from information_schema.columns
      where table_schema = 'public' and table_name = 'sessions' and column_name = 'workspace_id'`,
  )
  if (rows[0].n !== 1) {
    // Standing rule: DO NOT DELETE SOMEONE'S DATABASE — TELL THEM WHAT'S WRONG.
    throw new Error(
      "This database predates the migrations Minddyte knows how to apply\n" +
        "(it has no sessions.workspace_id column), so it cannot be upgraded in place.\n" +
        "NOTHING HAS BEEN DELETED. Your options:\n" +
        "  1. Copy the data directory somewhere safe first.\n" +
        "  2. bun run db:reset  — DESTROYS this database and starts a fresh one.",
    )
  }

  const [first] = readMigrationFiles({ migrationsFolder: MIGRATIONS_DIR })
  await pg.exec(`create schema if not exists drizzle`)
  await pg.exec(
    `create table if not exists drizzle.__drizzle_migrations (
       id serial primary key, hash text not null, created_at bigint)`,
  )
  await pg.query(
    `insert into drizzle.__drizzle_migrations (hash, created_at) values ($1, $2)`,
    [first.hash, first.folderMillis],
  )
}
