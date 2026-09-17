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
 * every write in the app until restart.
 *
 * This repair is enough for exactly one shape of caller: one that awaits
 * dumpToSql and only then lets anything else touch the database — true of
 * every caller that exists today. It is NOT enough on its own for a caller
 * running CONCURRENTLY with other database work: pgDump takes no mutex, so a
 * query racing this one would execute inside pg_dump's read-only transaction,
 * and a COMMIT from that query would end pg_dump's snapshot mid-dump. An
 * in-app export button would have to serialise itself against other writes;
 * that machinery is not built here, because no such caller exists yet.
 *
 * The repair runs in a `finally`, not just after a successful dump, because
 * `pgDump` is most likely to throw when the database is already unhealthy —
 * exactly the moment the connection must not ALSO be left poisoned on top of
 * whatever was already wrong.
 *
 * `args` passes straight through to `pgDump`'s own `args` option (e.g. `-t`
 * to filter which tables get dumped). Nothing here needs it; it exists so a
 * failure on a real, unmatched filter can exercise this exact error path in
 * tests, instead of a contrived one.
 */
export async function dumpToSql(pg: PGlite, args?: string[]): Promise<string> {
  try {
    const dump = await pgDump({ pg, args })
    return await dump.text()
  } finally {
    // ROLLBACK with no transaction open is a no-op warning in Postgres, not
    // an error — confirmed directly against PGlite, not assumed from the
    // server analogy — so this is safe to run whether pgDump got as far as
    // opening its transaction or failed before that.
    await pg.query('ROLLBACK')
    await pg.exec('SET search_path TO public')
  }
}
