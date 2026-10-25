// Runs the old and the new retrieval side by side on the same searches and
// the same data, and fails on any difference (ticket 20, Q4, Q10–Q12).
//
//   MINDDYTE_DATA_DIR=<copy> bun scripts/bench/compare-retrieval.ts \
//     --queries .scratch/bench-corpus/queries.json --old <git rev> \
//     [--sample 200] [--require-faster] [--check-bar] [--report <file>]
//
// ONLY EVER POINT IT AT A COPY: it pools every chat into one workspace.
// "Old" is src/services/retrieval.ts as it was at <rev>, loaded from
// .scratch/bench-old/ (where its relative and @/ imports still resolve).
// "New" is the working tree's.
//
// Every search compares step 3 (wholeDraftHits): the same chats, and for
// each, reach and strong equal within 1e-6 and the same phrase. Every 10th
// search, and all `t20` searches, also compare the whole retrieveContext:
// the same chats in the same order, with the same why, excerpts and dropped.
//   --sample N        run N searches, stratified by kind, `approved` left out
//   --require-faster  fail unless new beats old at p50 and p95 for every kind (Q12)
//   --check-bar       fail unless the t20 searches meet Q2: 1.5 s / 0.5 s, whole retrieveContext
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { sql } from 'drizzle-orm'
import { getDb } from '../../db'
import * as fresh from '../../src/services/retrieval'
import { queryText } from '../../src/lib/tokens'
import { poolWorkspaces, requireScratchDataDir } from './pool'
import { prng, type Query } from './make-queries'

type Hit = { chatId: string; reach: number; strong: number; phrase: string | null }
type Retrieval = typeof fresh
const EPS = 1e-6

const flag = (name: string) => process.argv.includes(name)
const value = (name: string) => {
  const i = process.argv.indexOf(name)
  return i === -1 ? undefined : process.argv[i + 1]
}

/** The old retrieval module, from a git revision, with wholeDraftHits exported. */
async function loadOld(rev: string): Promise<Retrieval> {
  const src = execFileSync('git', ['show', `${rev}:src/services/retrieval.ts`], { encoding: 'utf8' })
  const dir = path.resolve('.scratch/bench-old')
  mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `retrieval-${rev}.ts`)
  writeFileSync(file, /export async function wholeDraftHits/.test(src) ? src : `${src}\nexport { wholeDraftHits }\n`)
  return (await import(pathToFileURL(file).href)) as Retrieval
}

/** Every difference between two step-3 results, as readable lines. */
export function diffHits(a: Hit[], b: Hit[]): string[] {
  const out: string[] = []
  const byId = (xs: Hit[]) => new Map(xs.map((h) => [h.chatId, h]))
  const A = byId(a), B = byId(b)
  for (const [id, x] of A) {
    const y = B.get(id)
    if (!y) { out.push(`chat ${id} only in old`); continue }
    if (Math.abs(x.reach - y.reach) > EPS) out.push(`chat ${id} reach ${x.reach} vs ${y.reach}`)
    if (Math.abs(x.strong - y.strong) > EPS) out.push(`chat ${id} strong ${x.strong} vs ${y.strong}`)
    if (x.phrase !== y.phrase) out.push(`chat ${id} phrase ${JSON.stringify(x.phrase)} vs ${JSON.stringify(y.phrase)}`)
  }
  for (const id of B.keys()) if (!A.has(id)) out.push(`chat ${id} only in new`)
  return out
}

const pct = (xs: number[], p: number) => {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor(p * s.length))]
}
const median = (xs: number[]) => pct(xs, 0.5)

/** N searches, stratified by kind in proportion, `approved` left out, seed 20. */
function sample(queries: Query[], n: number): Query[] {
  const rand = prng(20)
  const pool = queries.filter((q) => q.kind !== 'approved')
  const kinds = [...new Set(pool.map((q) => q.kind))]
  const out: Query[] = []
  for (const k of kinds) {
    const of = pool.filter((q) => q.kind === k)
    const take = k === 't20' ? of.length : Math.max(1, Math.round((n * of.length) / pool.length))
    const shuffled = of.map((q) => [rand(), q] as const).sort((x, y) => x[0] - y[0]).map(([, q]) => q)
    out.push(...shuffled.slice(0, take))
  }
  return out
}

if (import.meta.main) {
  // Before the database is opened at all: it pools every chat into one workspace.
  requireScratchDataDir()
  const queriesFile = value('--queries') ?? '.scratch/bench-corpus/queries.json'
  const rev = value('--old')
  if (!rev) throw new Error('--old <git rev> is required')
  let queries = JSON.parse(readFileSync(queriesFile, 'utf8')) as Query[]
  const n = value('--sample')
  if (n) queries = sample(queries, Number(n))

  const db = await getDb()
  const ws = await poolWorkspaces(db)
  const [{ id: probe }] = ((await db.execute(sql`insert into sessions (workspace_id, title) values (${ws}, 'bench-probe') returning id`)) as unknown as { rows: { id: string }[] }).rows
  const old = await loadOld(rev)

  const times: Record<string, { old: number[]; new: number[]; oldFull: number[]; newFull: number[] }> = {}
  const differences: { id: string; kind: string; text: string; where: string; lines: string[] }[] = []
  const full = (r: Retrieval, text: string) => r.retrieveContext({ workspaceId: ws, sessionId: probe, mode: 'explore', taggedChatIds: [], draftText: text })
  const timed = async <X>(f: () => Promise<X>) => {
    const a = performance.now()
    const x = await f()
    return [x, performance.now() - a] as const
  }

  for (const [i, q] of queries.entries()) {
    const t = (times[q.kind] ??= { old: [], new: [], oldFull: [], newFull: [] })
    const draft = queryText(q.text)
    // Alternate which side runs first, so a warm cache favours neither.
    const order: Retrieval[] = i % 2 ? [fresh, old] : [old, fresh]
    const res = new Map<Retrieval, Hit[]>()
    for (const r of order) {
      const [hits, ms] = await timed(() => r.wholeDraftHits(ws, probe, draft) as Promise<Hit[]>)
      res.set(r, hits)
      ;(r === old ? t.old : t.new).push(ms)
    }
    const lines = diffHits(res.get(old)!, res.get(fresh)!)
    if (lines.length) differences.push({ id: q.id, kind: q.kind, text: q.text, where: 'step 3', lines })

    if (i % 10 === 0 || q.kind === 't20') {
      const runs = q.kind === 't20' ? 3 : 1
      const outs = new Map<Retrieval, string>()
      for (let k = 0; k < runs; k++) {
        for (const r of order) {
          const [ctx, ms] = await timed(() => full(r, q.text))
          outs.set(r, JSON.stringify(ctx))
          ;(r === old ? t.oldFull : t.newFull).push(ms)
        }
      }
      if (outs.get(old) !== outs.get(fresh)) {
        differences.push({ id: q.id, kind: q.kind, text: q.text, where: 'retrieveContext', lines: [outs.get(old)!, outs.get(fresh)!] })
      }
    }
    if ((i + 1) % 50 === 0) console.log(`${i + 1}/${queries.length} searches, ${differences.length} differences`)
  }
  await db.execute(sql`delete from sessions where id = ${probe}`)

  const perKind = Object.fromEntries(Object.entries(times).map(([k, t]) => [k, {
    n: t.old.length,
    step3: { oldP50: median(t.old), newP50: median(t.new), oldP95: pct(t.old, 0.95), newP95: pct(t.new, 0.95) },
    full: { n: t.newFull.length, oldP50: median(t.oldFull), newP50: median(t.newFull), oldP95: pct(t.oldFull, 0.95), newP95: pct(t.newFull, 0.95) },
  }]))
  const failures: string[] = []
  if (differences.length) failures.push(`${differences.length} searches differ`)
  if (flag('--require-faster')) {
    for (const [k, s] of Object.entries(perKind)) {
      if (!(s.step3.newP50 < s.step3.oldP50 && s.step3.newP95 < s.step3.oldP95)) failures.push(`${k}: new is not faster at p50 and p95`)
    }
  }
  if (flag('--check-bar')) {
    const t20 = queries.filter((q) => q.kind === 't20')
    const bars = [1500, 500]
    t20.forEach((q, j) => {
      const ms = times.t20.newFull.filter((_, k) => Math.floor(k / 3) === j)
      const m = median(ms)
      if (m > bars[j]) failures.push(`${q.id}: ${m.toFixed(0)} ms is over the ${bars[j]} ms bar`)
    })
  }

  const round = (x: number) => Math.round(x)
  console.log('\nkind'.padEnd(13), 'n'.padStart(4), '| step 3 p50 old→new | p95 old→new | full p50 old→new | full p95 old→new')
  for (const [k, s] of Object.entries(perKind)) {
    console.log(k.padEnd(12), String(s.n).padStart(4), `| ${round(s.step3.oldP50)} → ${round(s.step3.newP50)} ms | ${round(s.step3.oldP95)} → ${round(s.step3.newP95)} ms | ${round(s.full.oldP50)} → ${round(s.full.newP50)} ms | ${round(s.full.oldP95)} → ${round(s.full.newP95)} ms`)
  }
  const report = { rev, queries: queries.length, perKind, differences, failures }
  const reportFile = value('--report')
  if (reportFile) writeFileSync(reportFile, JSON.stringify(report, null, 1))
  console.log(failures.length ? `\nFAIL: ${failures.join('; ')}` : `\nOK: ${queries.length} searches, 0 differences`)
  process.exit(failures.length ? 1 : 0)
}
