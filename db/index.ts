import { PGlite } from '@electric-sql/pglite'
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm'
import { drizzle } from 'drizzle-orm/pglite'
import { ensureSchema } from './bootstrap'
import { runDataMigrations } from './data-migrations'
import { acquireLock, lockPathFor, releaseLock, startHeartbeat } from './lock'
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

/**
 * Postgres settings, sized for one visitor at a time rather than for a server.
 *
 * PGlite's defaults are a general-purpose Postgres's defaults, and they are
 * the difference between fitting on a small instance and not. Measured on a
 * 39 MB database: reopening it costs 644 MB of RSS with the defaults and
 * 226 MB with these — a 65% cut, and the reason a deployment stopped being
 * killed for exceeding its memory limit.
 *
 * The trade is real and it is the right way round here. Small shared_buffers
 * and work_mem mean less caching and more spilling to disk, which matters for
 * a database under concurrent load. This one serves a handful of visitors
 * reading their own few hundred rows, and it is single-connection by
 * architecture — PGlite has no second backend to contend with — so the
 * capacity being given up was never reachable.
 *
 * `initialMemory` is deliberately NOT set alongside these. Lowering it made
 * startup hang for over ten minutes rather than use less: the wasm heap has
 * to grow to the same place either way, and starting it small just makes it
 * get there slowly.
 */
const LEAN_POSTGRES = [
  'shared_buffers = 16MB',
  'work_mem = 1MB',
  'maintenance_work_mem = 8MB',
  'max_connections = 4',
  'effective_cache_size = 32MB',
  'wal_buffers = 512kB',
]

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
    pg = await PGlite.create({
      dataDir,
      extensions: { pg_trgm },
      postgresqlconf: LEAN_POSTGRES,
    })
  } catch (err) {
    // Standing rule: DO NOT DELETE SOMEONE'S DATABASE — TELL THEM WHAT'S WRONG.
    // The likeliest cause is a PGlite minor-version bump that no longer accepts
    // the on-disk format. A raw Postgres error here would tell nobody that.
    throw new Error(
      `Could not open Minddyte's database at ${dataDir}.\n` +
        'The most likely cause is that this directory was written by a different\n' +
        'PGlite version, which is an alpha-stage hazard this project accepts.\n' +
        'NOTHING HAS BEEN DELETED. Your options:\n' +
        '  1. Copy the folder below somewhere safe, right now, with your normal\n' +
        '     file manager or `cp -r` — it is inert files on disk, no database\n' +
        '     needs to open for that to work:\n' +
        `       ${dataDir}\n` +
        '     (bun run db:export cannot do this for you: it opens this exact\n' +
        '     database the exact same way that just failed, so it fails the same\n' +
        '     way, right back to this message.)\n' +
        '  2. bun run db:reset    — DESTROYS the graph and starts over\n' +
        `Original error: ${(err as Error).message}`,
    )
  }

  await ensureSchema(pg)

  // Release the lock on any CLEAN exit — Ctrl+C on `next dev`, or a script
  // like db-export/db-vacuum finishing and calling process.exit(0) — so the
  // next start sees a genuinely free directory instead of printing the
  // stale-lock warning on every single restart. Registered only after both
  // PGlite.create and ensureSchema succeeded: if either failed, this process
  // never legitimately held a healthy connection, and leaving the lock behind
  // for the NEXT start to flag as stale is the correct, honest outcome then.
  //
  // Must stay synchronous — 'exit' listeners cannot await anything — which is
  // exactly what releaseLock's rmSync already is.
  if (!inMemory) {
    const lockPath = lockPathFor(dataDir)
    process.on('exit', () => releaseLock(lockPath))

    // The claim has to be RENEWED, not just taken. Across containers a pid
    // proves nothing, so the only evidence that this instance is still alive
    // is that it keeps saying so; stop saying so and the lease expires and
    // the directory becomes takeable. The timer is unref'd inside
    // startHeartbeat, so it never holds a finished script open.
    startHeartbeat(lockPath)

    // A container is stopped with SIGTERM, which by default kills the process
    // WITHOUT emitting 'exit' — so the handler above would never run and the
    // replacement would sit out the full lease on every single deploy. That
    // matters here more than it looks: redeploying to the same URL is how
    // this app is meant to be updated.
    //
    // Re-raising rather than exiting: removing this listener and sending the
    // signal again reproduces exactly what would have happened without it,
    // and only when nothing else is listening. `next start` installs its own
    // graceful shutdown, and cutting that short with process.exit() would
    // drop connections this has no business dropping.
    for (const signal of ['SIGTERM', 'SIGINT'] as const) {
      const onSignal = () => {
        releaseLock(lockPath)
        process.removeListener(signal, onSignal)
        if (process.listenerCount(signal) === 0) process.kill(process.pid, signal)
      }
      process.on(signal, onSignal)
    }
  }

  const db = drizzle(pg, { schema: { ...schema, ...relations } })
  // After the schema is current, before any request can read it: a chat whose
  // messages have no pointers yet would retrieve as empty.
  await runDataMigrations(db)
  return { pg, db }
}

type Conn = Awaited<ReturnType<typeof open>>

/** The drizzle handle every service uses. Exported as a type so `Tx` can derive from it. */
export type Db = Conn['db']

const g = globalThis as typeof globalThis & { __minddyteConn?: Promise<Conn> }

function conn(): Promise<Conn> {
  // `??=` assigns the promise on first call and returns the SAME promise
  // afterwards, so concurrent callers all await one initialisation.
  //
  // The catch is what stops a FAILED open being cached forever. Without it
  // the rejected promise stays in this slot, every later request gets that
  // same rejection back in microseconds, and the process never tries again —
  // so one transient failure at boot bricks the server until someone
  // redeploys it. Seen in production on Render: the instance exceeded its
  // memory limit while PGlite was starting, restarted, and from then on every
  // database route returned 500 in 0.2s while /api/models kept answering,
  // because nothing was retrying.
  //
  // Clearing the slot means the next request starts a fresh attempt. If the
  // cause has passed, it recovers on its own; if it has not, it fails the
  // same way and says so again, which is the honest outcome either way.
  return (g.__minddyteConn ??= open().catch((err) => {
    g.__minddyteConn = undefined
    throw err
  }))
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
