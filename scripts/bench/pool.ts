// Shared by the retrieval benchmarks. ONLY EVER POINT THESE AT A COPY of the
// data: poolWorkspaces rewrites it.
import { sql } from 'drizzle-orm'
import type { getDb } from '../../db'

type Db = Awaited<ReturnType<typeof getDb>>

/** The one workspace the benchmark corpus is built in. */
export const BENCH_WS = '00000000-0000-4000-8000-0000000000b2'

/**
 * Why the benchmark must not touch this data directory, or null when it may.
 * Unset, the app opens the REAL database (./.data/minddyte), and pooling would
 * merge it into one workspace for good; every real database lives in a `.data`
 * folder, so any path through one is refused too.
 */
export function scratchDataDirProblem(dir: string | undefined): string | null {
  if (!dir) return 'MINDDYTE_DATA_DIR is not set, so this would open the real database. Point it at a copy.'
  if (dir.split(/[\\/]+/).includes('.data')) return `${dir} is inside a .data folder, where real databases live. Point MINDDYTE_DATA_DIR at a copy elsewhere.`
  return null
}

/** Stops the process unless MINDDYTE_DATA_DIR names a copy (scratchDataDirProblem). */
export function requireScratchDataDir(): void {
  const problem = scratchDataDirProblem(process.env.MINDDYTE_DATA_DIR)
  if (problem) {
    console.error(`refusing: ${problem}`)
    process.exit(1)
  }
}

/**
 * Puts every chat in one workspace, so retrieval can reach all of them, as
 * the earlier benchmarks did (.scratch/layered-memory/prototypes/reach-bench.ts,
 * step 0): Nodes are merged by canonical key first, their links moved onto the
 * survivor, and chat counts recomputed. `forgotten` is keyed by chat, so it
 * needs nothing. A database already in one workspace is left as it is.
 * Returns that workspace's id.
 */
export async function poolWorkspaces(db: Db): Promise<string> {
  requireScratchDataDir()
  const rows = (await db.execute(sql`select distinct workspace_id::text as w from sessions`)) as unknown as { rows: { w: string }[] }
  if (rows.rows.length === 1) return rows.rows[0].w
  const ws = '00000000-0000-4000-8000-0000000000b1'
  await db.transaction(async (tx) => {
    await tx.execute(sql`create temp table keep on commit drop as
      select canonical_key, (array_agg(id order by created_at, id))[1] as keeper from nodes group by canonical_key`)
    await tx.execute(sql`update session_nodes sn set node_id = k.keeper from nodes n join keep k using (canonical_key) where sn.node_id = n.id and n.id <> k.keeper`)
    await tx.execute(sql`update message_nodes mn set node_id = k.keeper from nodes n join keep k using (canonical_key) where mn.node_id = n.id and n.id <> k.keeper`)
    await tx.execute(sql`update sessions s set headline_node_id = k.keeper from nodes n join keep k using (canonical_key) where s.headline_node_id = n.id and n.id <> k.keeper`)
    await tx.execute(sql`delete from nodes n using keep k where n.canonical_key = k.canonical_key and n.id <> k.keeper`)
    await tx.execute(sql`update nodes set workspace_id = ${ws}, chat_count = (select count(*) from session_nodes sn where sn.node_id = nodes.id)`)
    await tx.execute(sql`update sessions set workspace_id = ${ws}`)
    await tx.execute(sql`update chat_pointers set workspace_id = ${ws}`)
  })
  return ws
}
