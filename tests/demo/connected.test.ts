import { describe, expect, it } from 'vitest'
import { emptyGraph, sendMessage, keysHeldOutside, nodeByKey } from '@/demo/graph'
import { looksLikeAQuestion } from '@/demo/reply'

/**
 * Regression, reported from the demo itself.
 *
 * Someone wrote "Research about SDG" and then "What is SDG" in the SAME
 * conversation. The second turn answered "Indexed SDG — already held by other
 * conversations here, so those are linked now" and drew the chip violet, while
 * the canvas showed SDG as a lone concept. No other conversation held it. The
 * transcript was claiming a link that the picture correctly refused to draw.
 *
 * The cause was the set used for "was this already here?": every key in the
 * graph, including the ones this very chat had just contributed.
 */
describe('keysHeldOutside', () => {
  it('does not count a concept this chat alone holds', () => {
    const g = sendMessage(emptyGraph(), { chatId: 'mine', userText: 'Research about SDG.' })

    expect(nodeByKey(g, 'sdg')).toBeDefined()
    // Present in the graph, but held only here — so it links to nothing.
    expect(keysHeldOutside(g, 'mine').has('sdg')).toBe(false)
  })

  it('counts it once a different chat holds it', () => {
    let g = sendMessage(emptyGraph(), { chatId: 'mine', userText: 'Research about SDG.' })
    // "SDG matters here", not "SDG reporting is mandatory": the extractor keys
    // a concept on its whole noun phrase, so "SDG reporting" would be a
    // different Node and the two chats would share nothing.
    g = sendMessage(g, { chatId: 'theirs', userText: 'SDG matters here.' })

    expect(keysHeldOutside(g, 'mine').has('sdg')).toBe(true)
    expect(keysHeldOutside(g, 'theirs').has('sdg')).toBe(true)
  })

  it('agrees with what the canvas calls shared', () => {
    let g = sendMessage(emptyGraph(), { chatId: 'a', userText: 'We run PostgreSQL in production.' })
    g = sendMessage(g, { chatId: 'a', userText: 'PostgreSQL again, same conversation.' })

    const node = nodeByKey(g, 'postgresql')
    // The canvas fills a concept in only when more than one chat holds it.
    expect(node?.chatIds).toHaveLength(1)
    // The transcript must reach the same verdict, or the two contradict.
    expect(keysHeldOutside(g, 'a').has('postgresql')).toBe(false)
  })
})

describe('looksLikeAQuestion', () => {
  it('catches a question with no question mark', () => {
    expect(looksLikeAQuestion('What is SDG')).toBe(true)
  })

  it('catches a request for an answer', () => {
    expect(looksLikeAQuestion('Research about SDG')).toBe(true)
    expect(looksLikeAQuestion('Explain the borrow checker')).toBe(true)
  })

  it('catches anything ending in a question mark', () => {
    expect(looksLikeAQuestion('Postgres on Kubernetes, right?')).toBe(true)
  })

  it('leaves a plain statement alone', () => {
    expect(looksLikeAQuestion('We run PostgreSQL on Kubernetes in production.')).toBe(false)
    expect(looksLikeAQuestion('I picked Rust for the parser.')).toBe(false)
  })
})
