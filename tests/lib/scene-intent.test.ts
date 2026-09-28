import { describe, it, expect } from 'vitest'
import { stripVisualize, visualizePrefixLength, wantsDiagram } from '@/lib/scene/intent'

describe('wantsDiagram', () => {
  it.each([
    '/visualize the unit circle',
    '  /VISUALIZE bubble sort',
    '/visualize 2x2 matrices',
    '/visualize',
    'show me how a sine wave relates to the unit circle',
    'Can you visualize bubble sort?',
    'visualise the partitions',
    'animate a WAL checkpoint',
    'illustrate how consumers read a partition',
    'draw me a binary tree',
    'draw the derivative',
    'a diagram of Kafka partitions please',
    'some diagrams would help',
  ])('triggers on %s', (m) => {
    expect(wantsDiagram(m)).toBe(true)
  })

  it.each([
    'The usual knowledge graph vs Minddyte',
    'What is the plot of Hamlet?',
    'graph of monthly sales',
    'I want to withdraw money',
    'the top drawer is stuck',
    'How does Kafka keep ordering?',
    'can you draw', // "draw" needs a following word
  ])('does not trigger on %s', (m) => {
    expect(wantsDiagram(m)).toBe(false)
  })

  it('still triggers mid-sentence through the word, even though the command only counts at the start', () => {
    expect(wantsDiagram('please /visualize this')).toBe(true)
  })
})

describe('stripVisualize', () => {
  it('removes the leading command for memory', () => {
    expect(stripVisualize('/visualize the unit circle')).toBe('the unit circle')
    expect(stripVisualize('  /Visualize   2x2 matrices')).toBe('2x2 matrices')
    expect(stripVisualize('/visualize')).toBe('')
  })
  it('leaves anything else alone', () => {
    expect(stripVisualize('show me the unit circle')).toBe('show me the unit circle')
    expect(stripVisualize('please /visualize this')).toBe('please /visualize this')
    expect(stripVisualize('/visualizer')).toBe('/visualizer')
  })
})

describe('visualizePrefixLength', () => {
  it('is exactly the length of what stripVisualize removes', () => {
    for (const message of ['/visualize the unit circle', '  /Visualize   2x2 matrices', '/visualize']) {
      expect(visualizePrefixLength(message)).toBe(message.length - stripVisualize(message).length)
    }
  })

  it('measures the command plus one trailing space', () => {
    expect(visualizePrefixLength('/visualize the unit circle')).toBe('/visualize '.length)
  })

  it('measures leading whitespace, the command, and trailing whitespace together', () => {
    expect(visualizePrefixLength('  /Visualize   2x2 matrices')).toBe('  /Visualize   '.length)
  })

  it('is the whole string for a bare command', () => {
    expect(visualizePrefixLength('/visualize')).toBe('/visualize'.length)
  })

  it('is 0 for anything that is not a /visualize command', () => {
    expect(visualizePrefixLength('show me the unit circle')).toBe(0)
    expect(visualizePrefixLength('please /visualize this')).toBe(0)
    expect(visualizePrefixLength('/visualizer')).toBe(0)
  })
})
