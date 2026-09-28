import { describe, it, expect } from 'vitest'
import { stripVisualize, blankVisualize, wantsDiagram } from '@/lib/scene/intent'
import { proseSpans } from '@/lib/prose'

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

describe('blankVisualize', () => {
  it('keeps the string the same length, with the command replaced by a non-space filler', () => {
    const input = '/visualize the unit circle'
    const out = blankVisualize(input)
    expect(out.length).toBe(input.length)
    expect(out).toBe('0'.repeat('/visualize'.length) + ' the unit circle')
  })

  it('leaves the offsets of everything after the command unchanged', () => {
    const input = '/visualize how a sine wave relates to the unit circle.'
    const out = blankVisualize(input)
    const tail = 'how a sine wave relates to the unit circle.'
    const idx = input.indexOf(tail)
    expect(out.slice(idx, idx + tail.length)).toBe(tail)
  })

  it('blanks leading whitespace plus the command together', () => {
    const input = '  /Visualize   2x2 matrices'
    const out = blankVisualize(input)
    expect(out.length).toBe(input.length)
    expect(out).toBe(`${'0'.repeat('  /Visualize'.length)}   2x2 matrices`)
  })

  it('leaves anything else alone, unchanged and same length', () => {
    expect(blankVisualize('show me the unit circle')).toBe('show me the unit circle')
    expect(blankVisualize('please /visualize this')).toBe('please /visualize this')
    expect(blankVisualize('/visualizer')).toBe('/visualizer')
  })

  it('does not turn the message into an indented code block (the filler is not whitespace)', () => {
    // A leading run of 4+ SPACES is read by CommonMark as an indented code
    // block, which would swallow the whole first paragraph — every sentence
    // in it — into one opaque `code` span instead of per-sentence pointers.
    // `/visualize` is 10 characters, so a plain space-blank always triggers
    // this. Regression for that: the paragraph must still split by sentence.
    const input = '/visualize how a sine wave relates to the unit circle. Then show cosine too.'
    const spans = proseSpans(blankVisualize(input))
    expect(spans.every((s) => s.kind === 'sentence')).toBe(true)
    expect(spans.length).toBe(2)
  })
})
