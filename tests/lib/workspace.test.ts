import { describe, expect, it } from 'vitest'
import {
  COOKIE_MAX_AGE,
  WORKSPACE_COOKIE,
  isWorkspaceId,
  newWorkspaceId,
} from '@/lib/workspace'

/**
 * A workspace id is the ONLY thing standing between one visitor and
 * another's conversations, so the two properties that matter are that it
 * cannot be guessed and that a guess cannot be passed off as one.
 */
describe('workspace identity', () => {
  it('mints a different id every time', () => {
    const ids = new Set(Array.from({ length: 100 }, newWorkspaceId))

    expect(ids.size).toBe(100)
  })

  it('accepts an id it minted', () => {
    expect(isWorkspaceId(newWorkspaceId())).toBe(true)
  })

  it('rejects anything that is not a v4 uuid', () => {
    // A cookie is client-controlled. Whatever arrives has to be proved, not
    // assumed — an unchecked value reaches a WHERE clause as-is.
    for (const bad of [
      '',
      'admin',
      '../../etc/passwd',
      "' OR 1=1 --",
      '11111111-1111-1111-1111-11111111111', // one char short
      '11111111-1111-1111-1111-1111111111111', // one char long
      'ZZZZZZZZ-1111-1111-1111-111111111111', // not hex
      // Right shape, wrong version — a v1 uuid. The `4` in the regex is the
      // only thing rejecting this, and nothing else in this list would fail
      // if that position were loosened to any hex digit.
      '11111111-1111-1111-8111-111111111111',
      // Right shape, wrong variant nibble: v4 requires 8, 9, a or b there.
      '11111111-1111-4111-c111-111111111111',
      null,
      undefined,
      42,
      {},
    ]) {
      expect(isWorkspaceId(bad)).toBe(false)
    }
  })

  it('names the cookie once, where both the reader and the writer see it', () => {
    expect(WORKSPACE_COOKIE).toBe('minddyte_ws')
  })

  it('expires the cookie after 30 days', () => {
    expect(COOKIE_MAX_AGE).toBe(30 * 24 * 60 * 60)
  })
})
