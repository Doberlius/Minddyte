import { describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm'
import { ensureSchema, hasSchema, migrationStatements } from '../../db/bootstrap'
import { firstMigrationStatements } from '../helpers/pglite'

// pg_trgm must be passed as a bundled extension on EVERY instance. The
// migration's `CREATE EXTENSION` statement fails without it, because a wasm
// build cannot load a shared library off disk the way a server Postgres does.
const fresh = () => PGlite.create({ extensions: { pg_trgm } })

describe('bootstrap', () => {
  it('splits the migration into executable statements', () => {
    const statements = migrationStatements()
    expect(statements.length).toBeGreaterThan(20)
    // If a breakpoint survives into a statement, the split silently failed.
    expect(statements.some((s) => s.includes('statement-breakpoint'))).toBe(false)
  })

  it('reports no schema on a fresh database', async () => {
    const pg = await fresh()
    expect(await hasSchema(pg)).toBe(false)
    await pg.close()
  })

  it('builds a fresh database through the migrator and records every migration', async () => {
    const pg = await fresh()
    const first = await ensureSchema(pg)
    expect(first.start).toBe('empty')
    expect(first.applied).toBeGreaterThanOrEqual(1)

    const { rows } = await pg.query<{ n: number }>(
      `select count(*)::int as n from drizzle.__drizzle_migrations`,
    )
    expect(rows[0].n).toBe(first.applied)

    // A second boot applies nothing. Drizzle's generated SQL is not
    // idempotent, so this must be skipped by the record, not survived.
    const second = await ensureSchema(pg)
    expect(second).toEqual({ start: 'tracked', applied: 0 })

    const { rows: tables } = await pg.query<{ n: number }>(
      `select count(*)::int as n from information_schema.tables
        where table_schema = 'public' and table_type = 'BASE TABLE'`,
    )
    expect(tables[0].n).toBe(13)
    await pg.close()
  })

  // The Render disk: created by the old bootstrap, which ran 0000's
  // statements and recorded nothing. It must be marked as having 0000
  // applied, not re-run, and it must keep its rows.
  it('marks a pre-migrator database as having 0000, and keeps its rows', async () => {
    const pg = await fresh()
    for (const s of firstMigrationStatements()) await pg.exec(s)
    await pg.exec(
      `insert into sessions (workspace_id, title) values ('00000000-0000-4000-8000-000000000001', 'kept')`,
    )

    const out = await ensureSchema(pg)
    expect(out.start).toBe('untracked')

    const { rows } = await pg.query<{ title: string }>(`select title from sessions`)
    expect(rows.map((r) => r.title)).toEqual(['kept'])
    await pg.close()
  })

  // Standing rule: never act on a database we do not understand. A database
  // from before workspace scoping has the tables but not this column, so it
  // is NOT 0000 and must not be marked as if it were.
  it('refuses to mark a database whose shape is not 0000, and deletes nothing', async () => {
    const pg = await fresh()
    await pg.exec(`create table sessions (id uuid primary key, title text)`)
    await pg.exec(`insert into sessions values ('00000000-0000-4000-8000-000000000002', 'old')`)

    await expect(ensureSchema(pg)).rejects.toThrow(/NOTHING HAS BEEN DELETED/)
    const { rows } = await pg.query<{ n: number }>(`select count(*)::int as n from sessions`)
    expect(rows[0].n).toBe(1)
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
