import { describe, expect, it } from 'vitest'
import { cpLength, cpSlice, validRange, quotedText, quotePreview } from '@/lib/quote'

describe('code-point helpers', () => {
  it('counts an astral character once', () => expect(cpLength('a😀b')).toBe(3))
  it('slices by code point, never splitting a surrogate pair', () => expect(cpSlice('a😀bc', 1, 3)).toBe('😀b'))
})

describe('validRange (Q17)', () => {
  const text = 'a😀bcd'
  it('accepts a whole-message quote', () => expect(validRange(text, null, null)).toBe(true))
  it('accepts the full range', () => expect(validRange(text, 0, cpLength(text))).toBe(true))
  it('accepts a range in the middle', () => expect(validRange(text, 1, 3)).toBe(true))
  it('refuses an empty range', () => expect(validRange(text, 2, 2)).toBe(false))
  it('refuses a negative start', () => expect(validRange(text, -1, 1)).toBe(false))
  it('refuses an end past the text', () => expect(validRange(text, 0, cpLength(text) + 1)).toBe(false))
  it('refuses a half-null range', () => {
    expect(validRange(text, 1, null)).toBe(false)
    expect(validRange(text, null, 1)).toBe(false)
  })
  it('refuses a reversed range', () => expect(validRange(text, 3, 1)).toBe(false))
  it('refuses non-integers', () => expect(validRange(text, 0.5, 2)).toBe(false))
})

describe('quotedText', () => {
  it('returns the slice for a highlighted part', () => expect(quotedText('a😀bcd', 1, 3)).toBe('😀b'))
  it('returns the whole text for a whole-message quote', () => expect(quotedText('a😀bcd', null, null)).toBe('a😀bcd'))
})

describe('quotePreview (the quote line)', () => {
  it('shows the first line of the quoted text', () => expect(quotePreview('  first line\nsecond', null, null)).toBe('first line'))
  it('shows the first line of a highlighted part', () => expect(quotePreview('ab cd\nef', 3, 8)).toBe('cd'))
  it('cuts at 80 code points with …, counting an emoji once', () => {
    const long = '😀' + 'x'.repeat(100)
    expect(quotePreview(long, null, null)).toBe('😀' + 'x'.repeat(79) + '…')
    expect(quotePreview('y'.repeat(80), null, null)).toBe('y'.repeat(80))
  })
})
