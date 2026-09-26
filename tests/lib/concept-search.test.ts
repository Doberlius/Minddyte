import { describe, expect, it } from 'vitest'
import { searchConcepts } from '@/lib/concept-search'

const names = ['Apple', 'Apple structure', 'Kafka', 'Kafka partitions', 'Tim Cook', 'certain changes', 'Café culture']
const find = (q: string) => searchConcepts(names, q, (n) => n)

describe('searchConcepts', () => {
  it('returns everything, unhighlighted, for an empty query', () => {
    expect(find('  ').map((m) => m.item)).toEqual(names)
    expect(find('').every((m) => m.at === null)).toBe(true)
  })

  it('ranks a name that starts with the text, then a word that starts with it, then any match', () => {
    // "ka": starts "Kafka", "Kafka partitions"; nothing else contains it.
    expect(find('ka').map((m) => m.item)).toEqual(['Kafka', 'Kafka partitions'])
    // "c": starts "certain changes" and "Café culture"; word-start in "Tim Cook"; inside "Apple structure".
    expect(find('c').map((m) => m.item)).toEqual(['certain changes', 'Café culture', 'Tim Cook', 'Apple structure'])
  })

  it('ignores case and accents, and highlights the original characters', () => {
    const [hit] = find('CAFE')
    expect(hit.item).toBe('Café culture')
    expect(hit.at).toEqual({ start: 0, end: 4 })
    expect('Café culture'.slice(hit.at!.start, hit.at!.end)).toBe('Café')
  })

  it('points at the match inside the name', () => {
    const [hit] = find('struct')
    expect(hit.item).toBe('Apple structure')
    expect('Apple structure'.slice(hit.at!.start, hit.at!.end)).toBe('struct')
  })

  it('finds nothing for text no name contains', () => {
    expect(find('zzz')).toEqual([])
  })
})
