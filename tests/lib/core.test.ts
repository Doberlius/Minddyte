import { describe, expect, it } from 'vitest'
import { validateCore } from '@/lib/core'

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
