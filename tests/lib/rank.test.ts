import { describe, it, expect } from 'vitest'
import { rankCandidates, AUTO_REACH_CAP, type Candidate } from '@/lib/rank'

const base = { lastReferencedAt: 1000, createdAt: 100 }
const node = (label: string, chatCount: number, isHeadlineOfCandidate = false) =>
  ({ label, chatCount, isHeadlineOfCandidate })

const c = (over: Partial<Candidate> & { chatId: string }): Candidate => ({
  kind: 'overlap', sharedNodes: [node('Kafka', 5)], ...base, ...over,
})

describe('rankCandidates', () => {
  it('puts a bridge above an overlap regardless of score', () => {
    const out = rankCandidates([
      c({ chatId: 'overlap-rich', sharedNodes: [node('A', 1), node('B', 1), node('C', 1)] }),
      c({ chatId: 'bridge-poor', kind: 'bridge', sharedNodes: [node('Z', 50)] }),
    ])
    expect(out[0].chatId).toBe('bridge-poor')
  })

  it('prefers the chat whose headline is the shared node', () => {
    const out = rankCandidates([
      c({ chatId: 'passing', sharedNodes: [node('Kafka', 15), node('Backpressure', 2)] }),
      c({ chatId: 'about-it', sharedNodes: [node('Kafka', 15, true)] }),
    ])
    expect(out[0].chatId).toBe('about-it')
  })

  it('weights a rare shared node above a common one', () => {
    const out = rankCandidates([
      c({ chatId: 'common', sharedNodes: [node('Kafka', 15)] }),
      c({ chatId: 'rare', sharedNodes: [node('Backpressure', 2)] }),
    ])
    expect(out[0].chatId).toBe('rare')
  })

  it('breaks a tie by recency, then by age, then by id', () => {
    const out = rankCandidates([
      c({ chatId: 'bbb', lastReferencedAt: 500 }),
      c({ chatId: 'aaa', lastReferencedAt: 500 }),
      c({ chatId: 'recent', lastReferencedAt: 900 }),
    ])
    expect(out.map((x) => x.chatId)).toEqual(['recent', 'aaa', 'bbb'])
  })

  it('is a total order — no input permutation changes the result', () => {
    const input = [
      c({ chatId: 'a', sharedNodes: [node('X', 3)] }),
      c({ chatId: 'b', kind: 'bridge' }),
      c({ chatId: 'c', sharedNodes: [node('Y', 1, true)] }),
    ]
    const forward = rankCandidates(input).map((x) => x.chatId)
    const reversed = rankCandidates([...input].reverse()).map((x) => x.chatId)
    expect(reversed).toEqual(forward)
  })

  it('exports a cap of 3 for automatic reaches', () => {
    expect(AUTO_REACH_CAP).toBe(3)
  })
})
