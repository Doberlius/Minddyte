/**
 * Measure what retrieval actually returns.
 *
 * Runs the application's own `retrieveContext` — not a copy of it — against the
 * labelled cases in `eval/cases.ts`, and reports precision, recall and MRR.
 *
 * ## The rule this exists to enforce
 *
 * It REFUSES to print a score from a corpus that cannot carry one. Four
 * conversations with no shared concept will happily produce "100% precision",
 * and that number is worse than no number: it looks like evidence. The gate
 * below is the whole point of the script, not a nicety attached to it.
 *
 * ## What it does not measure
 *
 * Whether linking conversations to concepts beats linking concepts to each
 * other. That comparison needs a second retriever to compare against, and the
 * rule chosen for ITS edges — co-occurrence, embeddings, a model — would
 * dominate the result. This measures the retriever that exists.
 *
 * Run: bun run eval:retrieval
 */
import { getDb, getClient, sessions, nodes } from '../db'
import { sql } from 'drizzle-orm'
import { retrieveContext } from '../src/services/retrieval'
import { CASES } from '../eval/cases'

/** Below these, a score is noise wearing a number. */
const FLOOR = { chats: 20, sharedConcepts: 8, cases: 10 }

type Scored = {
  label: string
  returned: string[]
  expected: string[]
  hits: number
  precision: number
  recall: number
  rr: number
  dropped: string[]
}

function pct(n: number): string {
  return `${(n * 100).toFixed(0)}%`
}

async function main() {
  const db = await getDb()

  const [{ chats }] = await db
    .select({ chats: sql<number>`count(*)`.mapWith(Number) })
    .from(sessions)
  const [{ shared }] = await db
    .select({ shared: sql<number>`count(*)`.mapWith(Number) })
    .from(nodes)
    .where(sql`${nodes.chatCount} > 1`)

  const live = CASES.filter((c) => !c.draft)
  const drafts = CASES.length - live.length

  console.log('corpus')
  console.log(`  conversations        ${chats}   (need ${FLOOR.chats})`)
  console.log(`  concepts in 2+ chats ${shared}   (need ${FLOOR.sharedConcepts})`)
  const draftNote = drafts ? `, ${drafts} draft skipped` : ''
  console.log(`  labelled cases       ${live.length}   (need ${FLOOR.cases}${draftNote})`)
  console.log()

  const missing: string[] = []
  if (chats < FLOOR.chats) missing.push(`${FLOOR.chats - chats} more conversations`)
  if (shared < FLOOR.sharedConcepts)
    missing.push(`${FLOOR.sharedConcepts - shared} more concepts held by two or more chats`)
  if (live.length < FLOOR.cases) missing.push(`${FLOOR.cases - live.length} more labelled cases`)

  if (missing.length > 0) {
    console.log('NO SCORE REPORTED.')
    console.log('This corpus cannot carry a number yet. Still needed:')
    for (const m of missing) console.log(`  - ${m}`)
    console.log()
    console.log('A precision figure from a corpus this size measures the corpus,')
    console.log('not the retriever. Use the app for a while, label cases in')
    console.log('eval/cases.ts from the question rather than from the output,')
    console.log('and run this again.')
    return
  }

  // Title -> id, so a human can write cases without touching uuids.
  const rows = await db.select({ id: sessions.id, title: sessions.title }).from(sessions)
  const idOf = new Map(rows.map((r) => [r.title, r.id]))
  const titleOf = new Map(rows.map((r) => [r.id, r.title]))

  const unresolved: string[] = []
  const resolve = (title: string): string | null => {
    const id = idOf.get(title)
    if (!id) unresolved.push(title)
    return id ?? null
  }

  const scored: Scored[] = []
  for (const c of live) {
    const from = resolve(c.from)
    const expected = c.expect.map(resolve).filter((id): id is string => id !== null)
    if (!from || expected.length === 0) continue

    const result = await retrieveContext({
      sessionId: from,
      mode: c.mode ?? 'explore',
      taggedChatIds: (c.tag ?? []).map(resolve).filter((id): id is string => id !== null),
      draftText: c.question,
    })

    const returned = result.chats.map((r) => r.id)
    const wanted = new Set(expected)
    const hits = returned.filter((id) => wanted.has(id)).length
    const firstHit = returned.findIndex((id) => wanted.has(id))

    scored.push({
      label: c.question,
      returned: returned.map((id) => titleOf.get(id) ?? id),
      expected: expected.map((id) => titleOf.get(id) ?? id),
      hits,
      precision: returned.length ? hits / returned.length : 0,
      recall: hits / expected.length,
      rr: firstHit === -1 ? 0 : 1 / (firstHit + 1),
      dropped: result.dropped,
    })
  }

  if (unresolved.length > 0) {
    console.log('titles that match no conversation (cases using them were skipped):')
    for (const t of [...new Set(unresolved)]) console.log(`  - ${t}`)
    console.log()
  }

  for (const s of scored) {
    const verdict = s.recall === 1 ? 'ok  ' : s.hits === 0 ? 'MISS' : 'part'
    console.log(`${verdict}  ${s.label}`)
    console.log(`      wanted   ${s.expected.join(' · ')}`)
    console.log(`      returned ${s.returned.join(' · ') || '(nothing)'}`)
    if (s.dropped.length) console.log(`      dropped for budget: ${s.dropped.join(' · ')}`)
    console.log()
  }

  const mean = (pick: (s: Scored) => number) =>
    scored.reduce((sum, s) => sum + pick(s), 0) / scored.length

  console.log('─'.repeat(52))
  console.log(`cases scored  ${scored.length}`)
  console.log(`precision     ${pct(mean((s) => s.precision))}`)
  console.log(`recall        ${pct(mean((s) => s.recall))}`)
  console.log(`MRR           ${mean((s) => s.rr).toFixed(2)}`)
  console.log()
  console.log('Precision is over what the retriever returned, which is capped;')
  console.log('recall is over what you labelled. Read them together — a cap of')
  console.log('three cannot recall four right answers however good the ranking.')
}

try {
  await main()
} finally {
  // Releases the data-directory lock, so a dev server can open it again.
  await (await getClient()).close()
}
