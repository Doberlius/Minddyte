import { describe, expect, it } from 'vitest'
import { classifyParts, labelParts } from '@/lib/label-parts'

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

/**
 * Ticket 10, F14/F15: which offered words may be ticked. Keys are what
 * canonicalKey gives ('Steve Wozniak' → 'stevewozniak').
 */
describe('classifyParts', () => {
  it('offers a word no other concept of the chat uses', () => {
    expect(classifyParts('Steve Jobs', 'stevejobs', [{ key: 'stevejobs', label: 'Steve Jobs' }, { key: 'apple', label: 'Apple' }])).toEqual([
      { word: 'Steve', kind: 'offer', partOf: [] },
      { word: 'Jobs', kind: 'offer', partOf: [] },
    ])
  })

  it('F14: a word that is itself a linked concept is its own concept', () => {
    expect(classifyParts('Kafka partitions', 'kafkapartitions', [{ key: 'kafka', label: 'Kafka' }])).toEqual([
      { word: 'Kafka', kind: 'own-concept', partOf: [] },
      { word: 'partitions', kind: 'offer', partOf: [] },
    ])
  })

  it('F15: a word inside another linked concept’s name is part of it', () => {
    const linked = [
      { key: 'stevejobs', label: 'Steve Jobs' },
      { key: 'stevewozniak', label: 'Steve Wozniak' },
      { key: 'apple', label: 'Apple' },
    ]
    expect(classifyParts('Steve Jobs', 'stevejobs', linked)).toEqual([
      { word: 'Steve', kind: 'part-of', partOf: ['Steve Wozniak'] },
      { word: 'Jobs', kind: 'offer', partOf: [] },
    ])
  })

  it('names every concept a word is part of, in a stable order, whatever the case', () => {
    const linked = [
      { key: 'kafkastreams', label: 'Kafka Streams' },
      { key: 'kafkaconnect', label: 'KAFKA Connect' },
      { key: 'kafkasink', label: 'kafka.sink' },
    ]
    expect(classifyParts('Kafka Streams', 'kafkastreams', linked)).toEqual([
      { word: 'Kafka', kind: 'part-of', partOf: ['KAFKA Connect', 'kafka.sink'] },
      { word: 'Streams', kind: 'offer', partOf: [] },
    ])
  })

  it('own concept wins over part of', () => {
    const linked = [
      { key: 'kafka', label: 'Kafka' },
      { key: 'kafkaconnect', label: 'Kafka Connect' },
    ]
    expect(classifyParts('Kafka Streams', 'kafkastreams', linked)[0]).toEqual({ word: 'Kafka', kind: 'own-concept', partOf: [] })
  })

  // Final review, item 5: the concept being forgotten never refuses its own words.
  it('never counts the concept being forgotten', () => {
    // canonicalKey('Kafka 数据') is 'kafka', the same as its word "Kafka".
    expect(classifyParts('Kafka 数据', 'kafka', [{ key: 'kafka', label: 'Kafka 数据' }])).toEqual([
      { word: 'Kafka', kind: 'offer', partOf: [] },
      { word: '数据', kind: 'offer', partOf: [] },
    ])
  })

  it('a word with no Latin letters or digits is never "its own concept" by an empty key', () => {
    expect(classifyParts('Kafka 数据', 'kafka', [{ key: '', label: '日本' }])).toEqual([
      { word: 'Kafka', kind: 'offer', partOf: [] },
      { word: '数据', kind: 'offer', partOf: [] },
    ])
  })
})
