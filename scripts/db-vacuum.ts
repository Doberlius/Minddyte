import { getClient } from '../db'

// Why this script exists at all: Postgres never overwrites a row on UPDATE —
// it writes a NEW version and marks the old one "dead". On a normal server, a
// background process called autovacuum reclaims those dead rows. PGlite has
// no background processes, so the fear is that dead rows just pile up
// forever and the database silently bloats.
//
// It turns out that does not happen here, for a structural reason: a dead
// row can only be reclaimed once NO transaction could still need to see it.
// That is exactly why a multi-connection server needs autovacuum — some
// other connection might be mid-query against the old version. Minddyte's
// database has exactly ONE connection, ever, so there is never another
// transaction to protect the old row for. Postgres notices this and cleans
// dead rows up opportunistically, the moment it next touches that page —
// no autovacuum required.
//
// This was measured, not assumed: 500 updates to one row, deliberately done
// in a way that skips the cheapest cleanup path, still left zero dead rows
// behind. So this script does not schedule or run any cleanup on a timer —
// that would be solving a problem that does not occur. What it DOES do is
// report the numbers, so that if this assumption is ever wrong on someone's
// machine, it shows up as a number instead of as silence.

type Stat = { relname: string; bytes: number; live: number; dead: number }

const STATS = `
  select relname,
         pg_total_relation_size(relid)::int8 as bytes,
         n_live_tup::int8 as live,
         n_dead_tup::int8 as dead
    from pg_stat_user_tables
   order by pg_total_relation_size(relid) desc
`

function show(label: string, rows: Stat[]) {
  console.log(`\n${label}`)
  console.log('table'.padEnd(20), 'size'.padStart(12), 'live'.padStart(8), 'dead'.padStart(8))
  for (const r of rows) {
    // ::int8 is a 64-bit integer, which node-postgres-style drivers hand back
    // as a string (to avoid silently losing precision above 2^53). Number(...)
    // converts it back for arithmetic and formatting; these columns are byte
    // counts and row counts, both far below the point where that would lose
    // precision.
    const kb = `${Math.round(Number(r.bytes) / 1024)} KB`
    console.log(r.relname.padEnd(20), kb.padStart(12), String(r.live).padStart(8), String(r.dead).padStart(8))
  }
  const total = rows.reduce((sum, r) => sum + Number(r.bytes), 0)
  console.log(`total: ${(total / 1024 / 1024).toFixed(1)} MB`)
}

const pg = await getClient()

const before = (await pg.query<Stat>(STATS)).rows
show('BEFORE', before)

// VACUUM cannot run inside a transaction block, so this goes through exec
// directly rather than through drizzle.
await pg.exec('vacuum')

const after = (await pg.query<Stat>(STATS)).rows
show('AFTER', after)

const deadBefore = before.reduce((s, r) => s + Number(r.dead), 0)
console.log(`\nDead tuples before vacuum: ${deadBefore}`)
if (deadBefore === 0) {
  // The expected result. Ticket 01 measured 0 after 500 non-HOT updates,
  // because single-connection means every dead row is immediately reclaimable.
  console.log('Nothing had accumulated — this is the expected result on a single-connection database.')
} else {
  console.log('Dead tuples were present. If this keeps happening, escalate:')
  console.log('  VACUUM FULL   — returns space to the OS; its exclusive lock is free here')
  console.log('  REINDEX       — if index size rather than table size is growing')
}
process.exit(0)
