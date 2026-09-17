import { describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm'
import { ensureSchema, hasSchema, migrationStatements } from '../../db/bootstrap'

// pg_trgm must be passed as a bundled extension on EVERY instance. The
// migration's `CREATE EXTENSION` statement fails without it, because a wasm
// build cannot load a shared library off disk the way a server Postgres does.
const fresh = () => PGlite.create({ extensions: { pg_trgm } })

describe('bootstrap', () => {
  it('splits the migration into executable statements', () => {
    const statements = migrationStatements()
    expect(statements.length).toBeGreaterThan(30)
    // If a breakpoint survives into a statement, the split silently failed.
    expect(statements.some((s) => s.includes('statement-breakpoint'))).toBe(false)
  })

  it('reports no schema on a fresh database', async () => {
    const pg = await fresh()
    expect(await hasSchema(pg)).toBe(false)
    await pg.close()
  })

  it('creates all 12 tables, and a second call is a no-op', async () => {
    const pg = await fresh()
    expect(await ensureSchema(pg)).toBe('created')

    const { rows } = await pg.query<{ n: number }>(
      `select count(*)::int as n
         from information_schema.tables
        where table_schema = 'public' and table_type = 'BASE TABLE'`,
    )
    expect(rows[0].n).toBe(12)

    // Drizzle's generated SQL is not idempotent, so a second run MUST be
    // skipped by the catalog check rather than survived by CREATE IF NOT EXISTS.
    expect(await ensureSchema(pg)).toBe('present')
    await pg.close()
  })

  it('loads pg_trgm and keeps its calibration', async () => {
    const pg = await fresh()
    await ensureSchema(pg)
    const { rows } = await pg.query<{ sim: number }>(
      `select similarity('kafka partitions', 'kafka partition') as sim`,
    )
    expect(rows[0].sim).toBeGreaterThan(0.5)
    await pg.close()
  })
})
