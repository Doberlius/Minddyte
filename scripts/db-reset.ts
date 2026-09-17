import { existsSync, rmSync } from 'node:fs'
import path from 'node:path'
import { resolveDataDir } from '../db'
import { lockPathFor, releaseLock } from '../db/lock'

const dataDir = path.resolve(resolveDataDir())
const lockPath = lockPathFor(dataDir)

if (!existsSync(dataDir)) {
  console.log(`Nothing to reset — no database at ${dataDir}`)
  process.exit(0)
}

// This is the ONE place allowed to do this, and only because a person typed
// `bun run db:reset`. Everywhere else, an unreadable database is reported,
// never removed.
rmSync(dataDir, { recursive: true, force: true })
releaseLock(lockPath)

console.log(`Deleted ${dataDir}`)
console.log('The schema will be recreated the next time the app starts.')
