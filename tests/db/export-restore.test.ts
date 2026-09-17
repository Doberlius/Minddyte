import { beforeEach, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm'
import { dumpToSql } from '../../db/export'
import { getClient } from '../../db'
import { countRows, newChat, truncateAll } from '../helpers/pglite'

beforeEach(truncateAll)

describe('export and restore', () => {
  it('produces portable SQL, not a version-tied binary blob', async () => {
    await newChat('a chat worth keeping')
    const pg = await getClient()

    const sqlText = await dumpToSql(pg)

    // Portable means readable SQL. A binary dumpDataDir() copy would not
    // contain these, and could not be restored into a different PGlite version.
    expect(sqlText).toContain('CREATE TABLE')
    expect(sqlText).toContain('sessions')
    expect(sqlText).toContain('a chat worth keeping')
  })

  it('restores into a SEPARATE fresh database with the same rows', async () => {
    // This is the whole point: exercise the recovery path while nothing is at
    // stake. A backup nobody has restored is a guess.
    await newChat('one')
    await newChat('two')
    expect(await countRows('sessions')).toBe(2)

    const pg = await getClient()
    const sqlText = await dumpToSql(pg)

    const restored = await PGlite.create({ extensions: { pg_trgm } })
    await restored.exec(sqlText)

    // pg_dump's own output starts with `set_config('search_path', '', false)`
    // — it schema-qualifies everything it writes (`public.sessions`) so that's
    // safe for the dump itself, but the empty search_path is left behind on
    // whichever connection ran it. Without restoring it here, the plain
    // `sessions` below would fail with "relation sessions does not exist" even
    // though the table and its rows are genuinely present under `public`. The
    // pglite-tools README calls this out as a known caveat of restoring.
    await restored.exec('SET search_path TO public')

    const { rows } = await restored.query<{ n: number }>(
      'select count(*)::int as n from sessions',
    )
    expect(rows[0].n).toBe(2)

    const titles = await restored.query<{ title: string }>(
      'select title from sessions order by title',
    )
    expect(titles.rows.map((r) => r.title)).toEqual(['one', 'two'])

    await restored.close()
  })

  it('repairs the connection even when the dump itself fails', async () => {
    // An honest failure, not a contrived one: pg_dump's own `-t` table filter
    // finds no match, so REAL pg_dump exits with a real error — but only
    // after it has already opened its read-only transaction. That is exactly
    // the failure mode the coordinator flagged: dumpToSql's repair must run
    // in a `finally`, because without one, this specific error path leaves
    // the connection permanently read-only.
    await newChat('still here after a failed dump')
    const pg = await getClient()

    await expect(dumpToSql(pg, ['-t', 'no_such_table_xyz'])).rejects.toThrow()

    // If the repair only ran on success, this would fail with "cannot
    // execute TRUNCATE TABLE / INSERT in a read-only transaction" — the same
    // error this whole wrapper exists to prevent.
    await newChat('and a write still works')
    expect(await countRows('sessions')).toBe(2)
  })
})
