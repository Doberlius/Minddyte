/**
 * Format 16 random bytes as a v4 uuid. Pure, so it can be tested without a
 * random source: the version nibble and the variant bits are forced, the rest
 * is whatever the bytes were.
 */
export function uuidV4FromBytes(bytes: Uint8Array): string {
  const b = Uint8Array.from(bytes)
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const hex = Array.from(b, (n) => n.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/**
 * A v4 uuid in any browser context. `crypto.randomUUID` exists only in secure
 * contexts (https or localhost); on a plain-http LAN address it is undefined
 * and calling it throws. `crypto.getRandomValues` works everywhere.
 */
export function newUuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return uuidV4FromBytes(crypto.getRandomValues(new Uint8Array(16)))
}
