import { describe, expect, it } from 'vitest'
import { newUuid, uuidV4FromBytes } from '@/lib/uuid'
import { isUuidV4 } from '@/lib/workspace'

describe('uuidV4FromBytes', () => {
  it('sets the version and variant bits on all-zero bytes', () => {
    expect(uuidV4FromBytes(new Uint8Array(16))).toBe('00000000-0000-4000-8000-000000000000')
  })

  it('sets the version and variant bits on all-ones bytes', () => {
    expect(uuidV4FromBytes(new Uint8Array(16).fill(0xff))).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff')
  })

  it('always produces a valid v4 uuid from random bytes', () => {
    for (let i = 0; i < 100; i++) {
      expect(isUuidV4(uuidV4FromBytes(crypto.getRandomValues(new Uint8Array(16))))).toBe(true)
    }
  })
})

describe('newUuid', () => {
  it('returns a valid v4 uuid', () => {
    expect(isUuidV4(newUuid())).toBe(true)
  })
})
