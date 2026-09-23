import { describe, it, expect } from 'vitest'
import { proseSentences, proseSpans } from '@/lib/prose'
import { splitSentences } from '@/lib/text'

/**
 * Ticket 11, decision 1: markdown is PARSED before sentences are picked.
 * Markup is not content; words are. These are the shapes that measured as
 * leaking into Compactions when the raw reply went straight to splitSentences.
 */

// The exact sample ticket 11's prototype measured (md-blocks.ts).
const SDG = `## 1.

Overview

The 2030 Agenda contains **17 Goals**, **169 targets** and **232 indicators**. Custodian agencies validate each one.

| Goal | Status |
|---|---|
| SDG 1 | tier I |

\`\`\`python
db = "postgres"
print(db)
\`\`\`

- bullet one
- bullet two
`

describe('proseSentences', () => {
  it('turns the measured 153-char markup blob into the clean sentence it was hiding', () => {
    expect(proseSentences(SDG)).toContain('Custodian agencies validate each one.')
  })

  it('never keeps heading hashes', () => {
    expect(proseSentences(SDG).some((s) => s.includes('#'))).toBe(false)
  })

  it('never keeps table rows or delimiters', () => {
    expect(proseSentences(SDG).some((s) => s.includes('|'))).toBe(false)
  })

  it('a code block never reaches the sentence splitter', () => {
    expect(proseSentences(SDG).some((s) => s.includes('print(db)'))).toBe(false)
  })

  it('keeps a list item\'s words and drops its marker', () => {
    const out = proseSentences(SDG)
    expect(out).toContain('bullet one')
    expect(out.some((s) => s.startsWith('- '))).toBe(false)
  })

  // Joining paragraphs before splitting reproduces the gluing bug: "Overview"
  // has no terminator, so it fused with the next paragraph's first sentence.
  it('splits each paragraph on its own, so a paragraph without a full stop is not glued to the next', () => {
    const out = proseSentences(SDG)
    expect(out).toContain('Overview')
    expect(out.some((s) => s.startsWith('Overview') && s.length > 'Overview'.length)).toBe(false)
  })

  it('leaves plain conversational text exactly as splitSentences does', () => {
    const plain = 'We tried max.poll.records=500 first, but that made it worse. Then we used 3.5 seconds.'
    expect(proseSentences(plain)).toEqual(splitSentences(plain))
  })

  it('returns nothing for whitespace', () => {
    expect(proseSentences('  \n ')).toEqual([])
  })
})

describe('proseSpans', () => {
  const slices = (t: string) => proseSpans(t).map((s) => ({ kind: s.kind, text: t.slice(s.start, s.end) }))

  it('gives every sentence an exact span into the original text', () => {
    const t = 'Kafka keeps order. Redis caches sessions.'
    expect(slices(t)).toEqual([
      { kind: 'sentence', text: 'Kafka keeps order.' },
      { kind: 'sentence', text: 'Redis caches sessions.' },
    ])
  })

  it('keeps a code block as ONE span, fences included', () => {
    const t = 'Set it like this:\n\n```properties\nmax.poll.records=500\n```'
    expect(slices(t)).toContainEqual({ kind: 'code', text: '```properties\nmax.poll.records=500\n```' })
  })

  it('keeps a table as ONE span', () => {
    const t = '| Goal | Status |\n|---|---|\n| SDG 1 | tier I |'
    expect(slices(t)).toEqual([{ kind: 'table', text: t }])
  })

  it('still skips headings', () => {
    expect(slices('## Setup\n\nKafka keeps order.')).toEqual([{ kind: 'sentence', text: 'Kafka keeps order.' }])
  })
})
