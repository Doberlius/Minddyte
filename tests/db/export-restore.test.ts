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
})
