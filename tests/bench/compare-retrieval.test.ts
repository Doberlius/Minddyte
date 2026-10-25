import { describe, expect, it } from 'vitest'
import { diffWords, exportsToAdd, oldFileName } from '../../scripts/bench/compare-retrieval'

/** Ticket 21: the comparison also checks wordHits, field by field. */
describe('diffWords', () => {
  const d = (ms: number) => new Date(ms)
  const base = () => ({
    chatsByWord: new Map([['kafka', new Set(['a', 'b'])], ['zebra', new Set<string>()]]),
    meta: new Map([['a', { title: 'A', createdAt: d(1), updatedAt: d(2) }], ['b', { title: 'B', createdAt: d(3), updatedAt: d(4) }]]),
    otherChats: 7,
  })

  it('finds nothing to report for the same result, whatever the set order', () => {
    const b = base()
    b.chatsByWord.set('kafka', new Set(['b', 'a']))
    expect(diffWords(base(), b)).toEqual([])
  })

  it('reports a different chat set for a word, a changed title or date, and a different chat count', () => {
    const b = base()
    b.chatsByWord.set('kafka', new Set(['a']))
    b.meta.set('a', { title: 'A2', createdAt: d(1), updatedAt: d(9) })
    b.meta.delete('b')
    b.otherChats = 8
    const lines = diffWords(base(), b)
    expect(lines.some((l) => l.includes('kafka'))).toBe(true)
    expect(lines.some((l) => l.includes('title'))).toBe(true)
    expect(lines.some((l) => l.includes('updatedAt'))).toBe(true)
    expect(lines.some((l) => l.includes('chat b only in old'))).toBe(true)
    expect(lines.some((l) => l.includes('otherChats'))).toBe(true)
  })
})

describe('exportsToAdd', () => {
  it('names the compared functions a revision does not export yet', () => {
    expect(exportsToAdd('async function wholeDraftHits() {}\nasync function wordHits() {}')).toEqual(['wholeDraftHits', 'wordHits'])
    expect(exportsToAdd('export async function wholeDraftHits() {}\nasync function wordHits() {}')).toEqual(['wordHits'])
    expect(exportsToAdd('export async function wholeDraftHits() {}\nexport async function wordHits() {}')).toEqual([])
  })
})

/**
 * Final review, minor 7: the old retrieval is written to a file named after
 * the git revision, and a revision like `origin/local-first` has a slash,
 * which made the write fail (it named a folder that does not exist).
 */
describe('oldFileName', () => {
  it('turns any git revision into one plain file name', () => {
    expect(oldFileName('2fd2105')).toBe('retrieval-2fd2105.ts')
    expect(oldFileName('origin/local-first')).toBe('retrieval-origin_local-first.ts')
    expect(oldFileName('HEAD~1')).toBe('retrieval-HEAD_1.ts')
    expect(oldFileName('feature\\x')).toBe('retrieval-feature_x.ts')
  })
})
