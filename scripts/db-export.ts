import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { dumpToSql } from '../db/export'
import { getClient, resolveDataDir } from '../db'
import { DataDirLockedError, lockPathFor, releaseLock } from '../db/lock'

// Exports live beside the data directory but are NOT inside it, so that
// `bun run db:reset` — which deletes the data directory — cannot take the
// backups with it. That would be the exact silent data loss the standing
// rule exists to prevent.
const outDir = path.join(process.cwd(), '.data', 'exports')
mkdirSync(outDir, { recursive: true })

const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const outPath = path.join(outDir, `minddyte-${stamp}.sql`)

// A live lock here means `next dev` (or another script) is already running
// against this data directory — an ordinary, expected condition, not a
// crash. It deserves the message written for it, not a raw stack trace.
// Mirrors scripts/db-reset.ts.
let pg
try {
  pg = await getClient()
} catch (err) {
  if (err instanceof DataDirLockedError) {
    console.error(err.message)
    process.exit(1)
  }
  throw err
}

writeFileSync(outPath, await dumpToSql(pg), 'utf8')

console.log(`Exported to ${outPath}`)
console.log('Restore into a fresh database with:')
console.log(`  psql -f "${outPath}"   (or PGlite.exec on the file's contents)`)

// Explicit here, not just left to db/index.ts's own exit handler, so a
// reader of THIS script sees the whole lifecycle — acquire (inside
// getClient), use, release — in one file. memory:// never acquires a lock
// (tests use it), so there is nothing to release in that case.
const dataDir = resolveDataDir()
if (!dataDir.startsWith('memory://')) releaseLock(lockPathFor(dataDir))
process.exit(0)
