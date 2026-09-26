import { describe, expect, it } from 'vitest'
import { labelParts } from '@/lib/label-parts'

describe('labelParts', () => {
  it('offers each word of a multi-word name, in order', () => {
    expect(labelParts('Steve Jobs')).toEqual(['Steve', 'Jobs'])
  })

  it('offers nothing for a one-word name', () => {
    expect(labelParts('Kafka')).toEqual([])
  })

  it('skips little words and one-letter words', () => {
    expect(labelParts('Our Kafka partitions')).toEqual(['Kafka', 'partitions'])
    expect(labelParts('A B')).toEqual([])
  })

  it('splits on punctuation and keeps the first spelling of a repeated word', () => {
    expect(labelParts('max.poll.records')).toEqual(['max', 'poll', 'records'])
    expect(labelParts('Kafka kafka Streams')).toEqual(['Kafka', 'Streams'])
  })
})
