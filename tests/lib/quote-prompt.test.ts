import { describe, expect, it } from 'vitest'
import type { UIMessage } from 'ai'
import { withQuote, withQuotes, type QuoteForModel } from '@/lib/quote-prompt'

describe('withQuote (Q19)', () => {
  it('leaves the text unchanged with no quote', () => {
    expect(withQuote('Why LRU?', null)).toBe('Why LRU?')
  })

  it('puts a highlighted part of a reply in front of the text', () => {
    const quote: QuoteForModel = { kind: 'part', role: 'assistant', text: 'caches hot keys' }
    expect(withQuote('Why LRU?', quote)).toBe('Replying to your earlier reply:\n> caches hot keys\n\nWhy LRU?')
  })

  it('names a quote of your own message as "my earlier message"', () => {
    const quote: QuoteForModel = { kind: 'whole', role: 'user', text: 'Tell me about Redis.' }
    expect(withQuote('And Memcached?', quote)).toBe('Replying to my earlier message:\n> Tell me about Redis.\n\nAnd Memcached?')
  })

  it('prefixes every line of a multi-line quote', () => {
    const quote: QuoteForModel = { kind: 'part', role: 'assistant', text: 'one\ntwo\r\n\nfour' }
    expect(withQuote('ok', quote)).toBe('Replying to your earlier reply:\n> one\n> two\n> \n> four\n\nok')
  })

  it('says a deleted target is gone, with no text', () => {
    expect(withQuote('Why?', { kind: 'deleted' })).toBe('Replying to a deleted message.\n\nWhy?')
  })

  it('sends a whole message as its first 200 code points, then …, never splitting an emoji', () => {
    const text = 'a'.repeat(199) + '😀' + 'tail'
    const out = withQuote('x', { kind: 'whole', role: 'assistant', text })
    expect(out).toBe('Replying to your earlier reply:\n> ' + 'a'.repeat(199) + '😀…\n\nx')
  })

  it('sends a whole message of exactly 200 code points with no …', () => {
    const text = '😀'.repeat(200)
    expect(withQuote('x', { kind: 'whole', role: 'user', text })).toBe('Replying to my earlier message:\n> ' + text + '\n\nx')
  })

  it('sends a highlighted part in full up to 2,000 code points, then …', () => {
    const text = 'b'.repeat(1999) + '😀' + 'more'
    const out = withQuote('x', { kind: 'part', role: 'assistant', text })
    expect(out).toBe('Replying to your earlier reply:\n> ' + 'b'.repeat(1999) + '😀…\n\nx')
  })

  it('sends a highlighted part of exactly 2,000 code points whole, with no …', () => {
    const text = '😀'.repeat(2000)
    expect(withQuote('x', { kind: 'part', role: 'assistant', text })).toBe('Replying to your earlier reply:\n> ' + text + '\n\nx')
  })
})

describe('withQuotes: the model view of a history', () => {
  const history = (): UIMessage[] => [
    { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'Tell me about Redis.' }] },
    { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'Redis caches hot keys.' }] },
    {
      id: 'u2', role: 'user', metadata: { quote: { replyToId: 'a1', start: null, end: null } },
      parts: [
        { type: 'text', text: 'Why ' },
        { type: 'file', mediaType: 'image/png', url: 'data:image/png;base64,AA==' },
        { type: 'text', text: 'LRU?' },
      ],
    },
  ]
  const quotes = new Map<string, QuoteForModel>([['u2', { kind: 'part', role: 'assistant', text: 'hot keys' }]])

  it('replaces a quoted user message’s text, keeping its other parts in place', () => {
    const view = withQuotes(history(), quotes)
    expect(view[2].parts).toEqual([
      { type: 'text', text: 'Replying to your earlier reply:\n> hot keys\n\nWhy LRU?' },
      { type: 'file', mediaType: 'image/png', url: 'data:image/png;base64,AA==' },
    ])
  })

  it('leaves unquoted user messages and replies as they are', () => {
    const before = history()
    const view = withQuotes(before, quotes)
    expect(view[0]).toEqual(before[0])
    expect(view[1]).toBe(before[1])
  })

  it('never changes the messages it was given', () => {
    const before = history()
    const copy = structuredClone(before)
    const view = withQuotes(before, quotes)
    expect(before).toEqual(copy)
    expect(view[2]).not.toBe(before[2])
    expect(view[2].parts).not.toBe(before[2].parts)
  })

  it('adds a text part to a quoted message that has none', () => {
    const view = withQuotes(
      [{ id: 'u', role: 'user', parts: [{ type: 'file', mediaType: 'image/png', url: 'data:,' }] }],
      new Map([['u', { kind: 'deleted' } as QuoteForModel]]),
    )
    expect(view[0].parts).toEqual([
      { type: 'text', text: 'Replying to a deleted message.\n\n' },
      { type: 'file', mediaType: 'image/png', url: 'data:,' },
    ])
  })
})
