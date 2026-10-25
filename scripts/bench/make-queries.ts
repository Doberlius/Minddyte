// The searches the retrieval comparison runs (ticket 20, Q9). Generated from
// the downloaded corpus files with a fixed seed, so every run makes exactly
// the same list; never from the database.
//
//   bun scripts/bench/make-queries.ts --corpus .scratch/bench-corpus \
//     --approved <bm25-eval-questions.md> <reach-eval-questions.md> <exam-eval-questions.md> \
//     --out .scratch/bench-corpus/queries.json
//
// The approved questions are the user's own (tickets 14, 16, 18): table rows
// whose first cell is an id like S1 or N10, the question in the second cell.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { splitSentences } from '../../src/lib/text'
import { contentTokens } from '../../src/lib/tokens'
import { articleSections, bookList } from './corpus'

export type QueryKind = 'phrase' | 'sentence' | 'passage370' | 'bag24' | 'unrelated' | 'typo' | 't20' | 'approved'
export type Query = { id: string; kind: QueryKind; text: string }

/** The two drafts ticket 20 measured, verbatim. */
export const T20_DRAFTS = [
  'I have been thinking about how our event pipeline handles ordering when consumers fall behind. If we add more partitions to the topic, do we lose the ordering guarantees we rely on for account updates, and would it be better to key messages by account id so that every update for one account always lands in the same partition, even when we scale the consumer group out later?',
  'How do Kafka partitions keep order?',
]

/** mulberry32: a tiny seeded PRNG, so the list is the same on every run. */
export function prng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const args = (flag: string) => {
  const i = process.argv.indexOf(flag)
  if (i === -1) return []
  const out: string[] = []
  for (let j = i + 1; j < process.argv.length && !process.argv[j].startsWith('--'); j++) out.push(process.argv[j])
  return out
}

/** A span of `min`..`max` characters of `text`, starting and ending on word boundaries, or null. */
function span(text: string, min: number, max: number, rand: () => number): string | null {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat.length < min + 20) return null
  const starts = [...flat.matchAll(/(?:^| )(?=\S)/g)].map((m) => m.index! + (m[0] === ' ' ? 1 : 0)).filter((i) => i + min <= flat.length)
  if (!starts.length) return null
  const from = starts[Math.floor(rand() * starts.length)]
  const limit = from + min + Math.floor(rand() * (max - min + 1))
  const end = Math.min(limit, flat.length)
  const cut = end === flat.length ? end : flat.lastIndexOf(' ', end)
  const piece = flat.slice(from, cut).trim()
  return piece.length >= min && piece.length <= max ? piece : null
}

/** One letter swapped with its neighbour, inside one word of at least five letters, or null. */
function typo(text: string, rand: () => number): string | null {
  const words = [...text.matchAll(/[A-Za-z]{5,}/g)]
  if (!words.length) return null
  const w = words[Math.floor(rand() * words.length)]
  const at = w.index! + 1 + Math.floor(rand() * (w[0].length - 2))
  const swapped = text.slice(0, at) + text[at + 1] + text[at] + text.slice(at + 2)
  return swapped === text ? null : swapped
}

export function approvedQuestions(files: string[]): string[] {
  const out: string[] = []
  for (const f of files) {
    for (const line of readFileSync(f, 'utf8').split(/\r?\n/)) {
      const cells = line.split('|').map((c) => c.trim())
      if (cells.length >= 3 && /^[A-Z]\d+$/.test(cells[1]) && cells[2]) out.push(cells[2])
    }
  }
  return out
}

export function makeQueries(corpusDir: string, approvedFiles: string[], seed = 20): Query[] {
  const rand = prng(seed)
  const pick = <X>(xs: X[]) => xs[Math.floor(rand() * xs.length)]
  const articles = readdirSync(path.join(corpusDir, 'wiki')).filter((f) => f.endsWith('.json')).sort()
    .map((f) => JSON.parse(readFileSync(path.join(corpusDir, 'wiki', f), 'utf8')) as { title: string; extract: string })
  const sections = articles.flatMap((a) => articleSections(a.title, a.extract).map((s) => s.text))
  const sentences = sections.flatMap((t) => splitSentences(t)).map((s) => s.trim()).filter((s) => s.length >= 40 && s.length <= 300 && /[a-z]/.test(s))
  const unrelated = bookList().find((b) => b.use === 'unrelated')!
  const book = readFileSync(path.join(corpusDir, 'books', `${unrelated.id}.txt`), 'utf8')

  const out: Query[] = []
  const add = (kind: QueryKind, n: number, make: () => string | null) => {
    let made = 0
    for (let tries = 0; made < n && tries < n * 50; tries++) {
      const text = make()
      if (!text) continue
      made++
      out.push({ id: `${kind}-${String(made).padStart(3, '0')}`, kind, text })
    }
    if (made < n) throw new Error(`only made ${made} of ${n} ${kind} searches`)
  }
  const phrase = () => {
    const words = pick(sentences).split(/\s+/).map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')).filter((w) => /\p{L}/u.test(w))
    const len = 2 + Math.floor(rand() * 3)
    if (words.length < len) return null
    const from = Math.floor(rand() * (words.length - len + 1))
    return words.slice(from, from + len).join(' ')
  }
  add('phrase', 200, phrase)
  add('sentence', 200, () => pick(sentences))
  add('passage370', 200, () => span(pick(sections), 330, 400, rand))
  add('bag24', 150, () => {
    const a = pick(articles)
    const words = [...new Set(contentTokens(a.extract))]
    if (words.length < 24) return null
    const chosen: string[] = []
    while (chosen.length < 24) {
      const w = pick(words)
      if (!chosen.includes(w)) chosen.push(w)
    }
    return chosen.join(' ')
  })
  add('unrelated', 100, () => span(book, 100, 400, rand))
  add('typo', 150, () => typo(rand() < 0.5 ? phrase() ?? '' : pick(sentences), rand))
  T20_DRAFTS.forEach((text, i) => out.push({ id: `t20-${i + 1}`, kind: 't20', text }))
  approvedQuestions(approvedFiles).forEach((text, i) => out.push({ id: `approved-${String(i + 1).padStart(3, '0')}`, kind: 'approved', text }))
  return out
}

if (import.meta.main) {
  const [corpus = '.scratch/bench-corpus'] = args('--corpus')
  const [outFile = path.join(corpus, 'queries.json')] = args('--out')
  const queries = makeQueries(corpus, args('--approved'))
  writeFileSync(outFile, JSON.stringify(queries, null, 1))
  const counts: Record<string, number> = {}
  for (const q of queries) counts[q.kind] = (counts[q.kind] ?? 0) + 1
  console.log(JSON.stringify({ total: queries.length, ...counts }))
}
