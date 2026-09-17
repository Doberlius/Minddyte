import { existsSync, rmSync } from 'node:fs'
import path from 'node:path'
import { resolveDataDir } from '../db'
import { acquireLock, releaseLock, DataDirLockedError } from '../db/lock'

const dataDir = path.resolve(resolveDataDir())

if (!existsSync(dataDir)) {
  console.log(`Nothing to reset — no database at ${dataDir}`)
  process.exit(0)
}

// Reuse acquireLock's own liveness check instead of writing a second one:
// it throws DataDirLockedError when a LIVE process still holds the lock
// (standing rule — DO NOT DELETE SOMEONE'S DATABASE, TELL THEM WHAT'S
// WRONG — applies to a running `next dev` exactly as much as to a stray
// file), and it silently clears a merely stale lock (dead pid) and claims
// it for this process, which is exactly what should happen before a reset.
let lockPath: string
try {
  lockPath = acquireLock(dataDir)
} catch (err) {
  if (err instanceof DataDirLockedError) {
    console.error(err.message)
    process.exit(1)
  }
  throw err
}

// This is the ONE place allowed to do this, and only because a person typed
// `bun run db:reset`. Everywhere else, an unreadable database is reported,
// never removed.
rmSync(dataDir, { recursive: true, force: true })
releaseLock(lockPath)

console.log(`Deleted ${dataDir}`)
console.log('The schema will be recreated the next time the app starts.')
