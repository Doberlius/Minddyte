// The benchmark corpus's shape, shared by fetch-corpus.ts, build-corpus.ts
// and make-queries.ts. Pure: no database, no network.
import { readFileSync } from 'node:fs'
import path from 'node:path'

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))

/** The lines of a list file next to this one that are not blank and not `#` comments. */
export function listLines(file: string): string[] {
  return readFileSync(path.join(here, file), 'utf8')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
}

/** books.txt as records. */
export function bookList(): { id: string; title: string; use: 'corpus' | 'unrelated' }[] {
  return listLines('books.txt').map((l) => {
    const [id, title, use] = l.split('\t')
    return { id, title, use: use as 'corpus' | 'unrelated' }
  })
}

export const slug = (title: string) => title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

const SKIPPED_SECTIONS = new Set(['references', 'external links', 'see also', 'notes', 'further reading', 'bibliography', 'sources', 'citations'])

/** An article's sections: the lead under the article's title, then one per heading line (any level). Reference-like sections and empty ones are left out. */
export function articleSections(title: string, extract: string): { heading: string; text: string }[] {
  const out: { heading: string; text: string }[] = []
  let heading = title
  let lines: string[] = []
  const flush = () => {
    const text = lines.join('\n').trim()
    if (text && !SKIPPED_SECTIONS.has(heading.toLowerCase())) out.push({ heading, text })
  }
  for (const line of extract.split(/\r?\n/)) {
    const h = /^=+\s*(.+?)\s*=+$/.exec(line.trim())
    if (h) {
      flush()
      heading = h[1]
      lines = []
    } else lines.push(line)
  }
  flush()
  return out
}

/** A book in turns of at most `max` characters, split at blank lines (a longer paragraph is its own turn). */
export function bookTurns(text: string, max = 20_000): string[] {
  const turns: string[] = []
  let cur = ''
  for (const para of text.split(/\n\s*\n/)) {
    if (cur && cur.length + para.length + 2 > max) {
      turns.push(cur)
      cur = ''
    }
    cur = cur ? `${cur}\n\n${para}` : para
  }
  if (cur.trim()) turns.push(cur)
  return turns
}
