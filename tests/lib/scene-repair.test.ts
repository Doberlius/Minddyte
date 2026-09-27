import { describe, it, expect } from 'vitest'
import { parseRepairBody, repairPrompt, REPAIR_SYSTEM, type RepairBody } from '@/lib/scene/repair'

const ids = { sessionId: '0b6f7c1e-8a4d-4f7a-9c2e-3d5b6a7c8d9e', messageId: '6f1c2d3e-4b5a-4c7d-8e9f-0a1b2c3d4e5f' }

describe('parseRepairBody', () => {
  it('accepts a repair request and a save request', () => {
    expect(parseRepairBody({ ...ids, blockIndex: 0, error: 'ReferenceError: sphere is not defined' })).toMatchObject({ save: false, blockIndex: 0 })
    expect(parseRepairBody({ ...ids, blockIndex: 1, save: true, code: 'play(create(axes()))' })).toMatchObject({ save: true, code: 'play(create(axes()))' })
  })
  it.each([
    [{ ...ids, blockIndex: 2, error: 'x' }],
    [{ ...ids, blockIndex: -1, error: 'x' }],
    [{ ...ids, blockIndex: 0.5, error: 'x' }],
    [{ ...ids, sessionId: "' or 1=1 --", blockIndex: 0, error: 'x' }],
    [{ ...ids, blockIndex: 0 }],
    [{ ...ids, blockIndex: 0, save: true }],
    [{ ...ids, blockIndex: 0, save: true, code: 'x'.repeat(20_001) }],
    [null],
    ['string'],
  ])('refuses %j', (body) => {
    expect(parseRepairBody(body)).toBeNull()
  })
  it('truncates a long error instead of refusing it', () => {
    // `error` exists only on the `save: false` branch of the RepairBody union;
    // TS won't let a plain `!.error` through without narrowing first (checked
    // with `npx tsc --noEmit`), so the same runtime assertion is made through
    // an `Extract` cast instead of loosening it.
    const parsed = parseRepairBody({ ...ids, blockIndex: 0, error: 'e'.repeat(5000) }) as Extract<RepairBody, { save: false }>
    expect(parsed.error.length).toBe(2000)
  })
})

describe('repairPrompt', () => {
  it('shows the failing code and error, and an earlier failed fix when given', () => {
    const p = repairPrompt({ code: 'play(create(sphere()))', error: 'ReferenceError: sphere is not defined', previous: { code: 'play(ball())', error: 'ReferenceError: ball is not defined' } })
    expect(p).toContain('play(create(sphere()))')
    expect(p).toContain('sphere is not defined')
    expect(p).toContain('play(ball())')
    expect(REPAIR_SYSTEM).toContain('```scene')
  })
})
