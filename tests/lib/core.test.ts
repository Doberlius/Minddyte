import { describe, expect, it } from 'vitest'
import { lastEditedLabel, validateCore } from '@/lib/core'

describe('validateCore', () => {
  it('accepts up to the limit', () => {
    expect(validateCore('a'.repeat(1500))).toEqual({ ok: true })
  })
  it('rejects one over, in plain words, and says how much to cut', () => {
    const r = validateCore('a'.repeat(1501))
    expect(r.ok).toBe(false)
    expect(!r.ok && r.message).toMatch(/1,500/)
  })
})

describe('lastEditedLabel', () => {
  const now = new Date('2026-09-25T12:00:00Z')
  const ago = (ms: number) => new Date(now.getTime() - ms)
  const MIN = 60_000
  const HOUR = 60 * MIN
  const DAY = 24 * HOUR

  it('says nothing has been written when there is no date', () => {
    expect(lastEditedLabel(null, now)).toBe('Not written yet')
  })
  it('says "just now" under a minute', () => {
    expect(lastEditedLabel(now, now)).toBe('Edited just now')
    expect(lastEditedLabel(ago(59_000), now)).toBe('Edited just now')
  })
  it('counts minutes, singular and plural', () => {
    expect(lastEditedLabel(ago(MIN), now)).toBe('Edited 1 minute ago')
    expect(lastEditedLabel(ago(5 * MIN), now)).toBe('Edited 5 minutes ago')
    expect(lastEditedLabel(ago(59 * MIN), now)).toBe('Edited 59 minutes ago')
  })
  it('counts hours, singular and plural', () => {
    expect(lastEditedLabel(ago(HOUR), now)).toBe('Edited 1 hour ago')
    expect(lastEditedLabel(ago(3 * HOUR), now)).toBe('Edited 3 hours ago')
    expect(lastEditedLabel(ago(23 * HOUR), now)).toBe('Edited 23 hours ago')
  })
  it('says "yesterday" for one day', () => {
    expect(lastEditedLabel(ago(DAY), now)).toBe('Edited yesterday')
    expect(lastEditedLabel(ago(DAY + 5 * HOUR), now)).toBe('Edited yesterday')
  })
  it('counts days up to a month', () => {
    expect(lastEditedLabel(ago(2 * DAY), now)).toBe('Edited 2 days ago')
    expect(lastEditedLabel(ago(3 * DAY), now)).toBe('Edited 3 days ago')
    expect(lastEditedLabel(ago(29 * DAY), now)).toBe('Edited 29 days ago')
  })
  it('counts months, singular and plural, up to a year', () => {
    expect(lastEditedLabel(ago(30 * DAY), now)).toBe('Edited 1 month ago')
    expect(lastEditedLabel(ago(60 * DAY), now)).toBe('Edited 2 months ago')
    expect(lastEditedLabel(ago(364 * DAY), now)).toBe('Edited 12 months ago')
  })
  it('stops counting after a year', () => {
    expect(lastEditedLabel(ago(365 * DAY), now)).toBe('Edited over a year ago')
    expect(lastEditedLabel(ago(900 * DAY), now)).toBe('Edited over a year ago')
  })
  it('treats a date slightly in the future (clock skew) as just now', () => {
    expect(lastEditedLabel(new Date(now.getTime() + 5_000), now)).toBe('Edited just now')
  })
})
