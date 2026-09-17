import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pgDump } from '@electric-sql/pglite-tools/pg_dump'
import { getClient } from '../db'

// Exports live beside the data directory but are NOT inside it, so that
// `bun run db:reset` — which deletes the data directory — cannot take the
// backups with it. That would be the exact silent data loss the standing
// rule exists to prevent.
const outDir = path.join(process.cwd(), '.data', 'exports')
mkdirSync(outDir, { recursive: true })

const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const outPath = path.join(outDir, `minddyte-${stamp}.sql`)

const pg = await getClient()
const dump = await pgDump({ pg })
writeFileSync(outPath, await dump.text(), 'utf8')

console.log(`Exported to ${outPath}`)
console.log('Restore into a fresh database with:')
console.log(`  psql -f "${outPath}"   (or PGlite.exec on the file's contents)`)
process.exit(0)
