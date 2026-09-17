import { PGlite } from '@electric-sql/pglite'
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm'
import { drizzle } from 'drizzle-orm/pglite'
import { ensureSchema } from './bootstrap'
import { acquireLock } from './lock'
import * as schema from './schema'
import * as relations from './apiRelations'

export const DEFAULT_DATA_DIR = './.data/minddyte'

/**
 * One env var, one default. The packaging effort SETS this variable rather
 * than changing code, which makes %APPDATA%\Minddyte on Windows and
 * ~/Library/Application Support/Minddyte on macOS a default rather than a
 * code change. Ticket 02, decision 1.
 *
 * `memory://` is PGlite's in-memory form. Tests use it; nothing is on disk,
 * so there is no directory for a second process to corrupt.
 */
export function resolveDataDir(): string {
  return process.env.MINDDYTE_DATA_DIR ?? DEFAULT_DATA_DIR
}

async function open() {
  const dataDir = resolveDataDir()
  const inMemory = dataDir.startsWith('memory://')

  // Nothing on disk means nothing to lock, and taking a lock would make the
  // test suite's parallel files fight over one file for no reason.
  if (!inMemory) acquireLock(dataDir)

  let pg: PGlite
  try {
    // pg_trgm has to be handed in as a bundled extension: a wasm build cannot
    // load a shared library off disk the way a server Postgres does.
    pg = await PGlite.create({ dataDir, extensions: { pg_trgm } })
  } catch (err) {
    // Standing rule: DO NOT DELETE SOMEONE'S DATABASE — TELL THEM WHAT'S WRONG.
    // The likeliest cause is a PGlite minor-version bump that no longer accepts
    // the on-disk format. A raw Postgres error here would tell nobody that.
    throw new Error(
      `Could not open Minddyte's database at ${dataDir}.\n` +
        'The most likely cause is that this directory was written by a different\n' +
        'PGlite version, which is an alpha-stage hazard this project accepts.\n' +
        'NOTHING HAS BEEN DELETED. Your options:\n' +
        '  1. bun run db:export   — try to save what is there first\n' +
        '  2. bun run db:reset    — DESTROYS the graph and starts over\n' +
        `Original error: ${(err as Error).message}`,
    )
  }

  await ensureSchema(pg)
  return { pg, db: drizzle(pg, { schema: { ...schema, ...relations } }) }
}

type Conn = Awaited<ReturnType<typeof open>>

/** The drizzle handle every service uses. Exported as a type so `Tx` can derive from it. */
export type Db = Conn['db']

const g = globalThis as typeof globalThis & { __minddyteConn?: Promise<Conn> }

function conn(): Promise<Conn> {
  // `??=` assigns the promise on first call and returns the SAME promise
  // afterwards, so concurrent callers all await one initialisation.
  return (g.__minddyteConn ??= open())
}

export async function getDb(): Promise<Db> {
  return (await conn()).db
}

/** The raw PGlite handle. Only db:export and db:vacuum need this. */
export async function getClient(): Promise<PGlite> {
  return (await conn()).pg
}

export * from './schema'
export * from './apiRelations'
