import { PGlite } from '@electric-sql/pglite'
import { pgDump } from '@electric-sql/pglite-tools/pg_dump'

/**
 * Dump `pg` to a SQL string, and hand the connection back exactly as usable
 * as it was found.
 *
 * `pgDump` runs its own `BEGIN`/`SET` on this SAME connection (PGlite is
 * single-connection by design — there is no separate socket for pg_dump to
 * open). Real `pg_dump` relies on the OS closing that socket to end its
 * read-only transaction; nothing here ever does that, so without repairing
 * it the connection is left stuck read-only with its search_path cleared —
 * every later write on it fails until the process restarts.
 *
 * That is invisible right now, because `scripts/db-export.ts` calls this
 * once and exits. It stops being invisible the moment export is wired up as
 * a button inside the running app: `getDb()`/`getClient()` cache ONE
 * connection per process, so a single export click would silently break
 * every write in the app until restart. Fixing it here, once, means every
 * future caller gets the repair for free instead of rediscovering this the
 * same way it was discovered here — by running it against a real database.
 */
export async function dumpToSql(pg: PGlite): Promise<string> {
  const dump = await pgDump({ pg })
  const sqlText = await dump.text()

  await pg.query('ROLLBACK')
  await pg.exec('SET search_path TO public')

  return sqlText
}
