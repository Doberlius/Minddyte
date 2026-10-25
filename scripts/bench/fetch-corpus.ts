// Downloads the retrieval benchmark corpus (ticket 20, Q6): the Wikipedia
// articles in wiki-topics.txt and the Project Gutenberg books in books.txt.
//
//   bun scripts/bench/fetch-corpus.ts [--out .scratch/bench-corpus]
//
// Needs network access. Wikipedia is asked politely, through its official
// API: one request at a time, a second apart, under an identifying
// User-Agent. Files already on disk are skipped, so a rerun only fetches
// what is missing. The text stays in --out, which is gitignored: it is never
// committed.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { bookList, listLines, slug } from './corpus'

const USER_AGENT = 'minddyte-bench/0.1 (https://github.com/Doberlius/Minddyte)'
const GAP_MS = 1000

const argAt = process.argv.indexOf('--out')
const out = argAt === -1 ? '.scratch/bench-corpus' : process.argv[argAt + 1]

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function fetchArticles() {
  const dir = path.join(out, 'wiki')
  mkdirSync(dir, { recursive: true })
  const missing: string[] = []
  let fetched = 0
  for (const title of listLines('wiki-topics.txt')) {
    const file = path.join(dir, `${slug(title)}.json`)
    if (existsSync(file)) { fetched++; continue }
    const url = 'https://en.wikipedia.org/w/api.php?' + new URLSearchParams({
      action: 'query', format: 'json', formatversion: '2', prop: 'extracts',
      explaintext: '1', exsectionformat: 'wiki', redirects: '1', titles: title,
    })
    try {
      const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
      const page = (await res.json())?.query?.pages?.[0]
      if (!res.ok || !page || page.missing || !page.extract?.trim()) {
        missing.push(title)
        console.log(`missing: ${title}`)
      } else {
        writeFileSync(file, JSON.stringify({ title: page.title, extract: page.extract }))
        fetched++
        console.log(`ok: ${page.title} (${page.extract.length} chars)`)
      }
    } catch (err) {
      missing.push(title)
      console.log(`failed: ${title}: ${(err as Error).message}`)
    }
    await sleep(GAP_MS)
  }
  return { fetched, missing }
}

/** A Gutenberg file without its licence header and footer. */
function bookBody(text: string): string {
  const start = text.search(/^\*\*\* ?START OF/m)
  const end = text.search(/^\*\*\* ?END OF/m)
  const from = start === -1 ? 0 : text.indexOf('\n', start) + 1
  return text.slice(from, end === -1 ? undefined : end).trim()
}

async function fetchBooks() {
  const dir = path.join(out, 'books')
  mkdirSync(dir, { recursive: true })
  let fetched = 0
  for (const { id, title } of bookList()) {
    const file = path.join(dir, `${id}.txt`)
    if (existsSync(file)) { fetched++; continue }
    const res = await fetch(`https://www.gutenberg.org/cache/epub/${id}/pg${id}.txt`, { headers: { 'User-Agent': USER_AGENT } })
    if (!res.ok) { console.log(`book failed: ${id} ${title} (${res.status})`); continue }
    const body = bookBody(await res.text())
    writeFileSync(file, body)
    fetched++
    console.log(`book ok: ${title} (${body.length} chars)`)
    await sleep(GAP_MS)
  }
  return fetched
}

if (import.meta.main) {
  const articles = await fetchArticles()
  const books = await fetchBooks()
  console.log(`fetched ${articles.fetched}, missing ${articles.missing.length}${articles.missing.length ? `: ${articles.missing.join(' | ')}` : ''}; books ${books}`)
}
