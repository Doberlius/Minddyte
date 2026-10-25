// Builds the downloaded corpus (fetch-corpus.ts) into a FRESH database,
// through the app's own save path: persistMessage, then finishTurn, exactly
// as a chat turn is saved, so passages, concepts and chat counts are real.
// No model is called.
//
//   MINDDYTE_DATA_DIR=<fresh dir> bun scripts/bench/build-corpus.ts [--in .scratch/bench-corpus]
//
// Ticket 20, Q8: each article is one chat and each section one turn, the user
// asking "Tell me about <section heading>" and the reply being the section.
// Each corpus book is one chat, in turns of at most 20,000 characters.
import { randomUUID } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { sql } from 'drizzle-orm'
import { getDb } from '../../db'
import { createChat } from '../../src/services/dbApi'
import { finishTurn, persistMessage } from '../../src/services/graph'
import { BENCH_WS } from './pool'
import { articleSections, bookList, bookTurns } from './corpus'

async function turn(sessionId: string, question: string, reply: string) {
  const messageId = await persistMessage({ workspaceId: BENCH_WS, sessionId, role: 'user', content: question })
  await finishTurn({
    workspaceId: BENCH_WS, sessionId, messageId, memoryDraft: question, text: reply,
    modelId: 'bench', assistantMessageId: randomUUID(), pointerShift: 0,
  })
}

if (import.meta.main) {
  const argAt = process.argv.indexOf('--in')
  const dir = argAt === -1 ? '.scratch/bench-corpus' : process.argv[argAt + 1]
  const db = await getDb()
  const [{ n }] = ((await db.execute(sql`select count(*)::int as n from sessions`)) as unknown as { rows: { n: number }[] }).rows
  if (n > 0) {
    console.error(`refusing: this database already holds ${n} chats; point MINDDYTE_DATA_DIR at a fresh directory`)
    process.exit(1)
  }
  const t0 = performance.now()
  const files = readdirSync(path.join(dir, 'wiki')).filter((f) => f.endsWith('.json')).sort()
  for (const [i, f] of files.entries()) {
    const { title, extract } = JSON.parse(readFileSync(path.join(dir, 'wiki', f), 'utf8')) as { title: string; extract: string }
    const { id } = await createChat(BENCH_WS)
    for (const s of articleSections(title, extract)) await turn(id, `Tell me about ${s.heading}`, s.text)
    if ((i + 1) % 25 === 0) console.log(`${i + 1}/${files.length} articles`)
  }
  for (const { id: bookId, title, use } of bookList()) {
    if (use !== 'corpus') continue
    const { id } = await createChat(BENCH_WS)
    const parts = bookTurns(readFileSync(path.join(dir, 'books', `${bookId}.txt`), 'utf8'))
    for (const [k, part] of parts.entries()) await turn(id, `Continue ${title}, part ${k + 1}`, part)
    console.log(`book: ${title}, ${parts.length} turns`)
  }
  const [counts] = ((await db.execute(sql`select
      (select count(*)::int from sessions) as chats,
      (select count(*)::int from messages) as messages,
      (select count(*)::int from chat_pointers) as "chatPointers",
      (select count(*)::int from nodes) as nodes,
      (select max(char_length(match_text))::int from chat_pointers) as "longestPointer"`)) as unknown as { rows: Record<string, number>[] }).rows
  console.log(JSON.stringify({ ...counts, seconds: Math.round((performance.now() - t0) / 1000) }))
  process.exit(0)
}
