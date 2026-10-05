/**
 * Reply-to quotes (Q17). A quote points at a message of the same chat, either
 * whole (both offsets null) or at a highlighted part of it. Offsets count code
 * points, because Postgres `substring()` counts characters, not UTF-16 units
 * (the same rule `chat_pointers` follows).
 */
export type QuoteRef = { replyToId: string; start: number | null; end: number | null }

/** Code-point length and slice: Postgres substring() counts characters, so offsets are code points. */
export function cpLength(s: string): number {
  let n = 0
  for (const _ of s) n++
  return n
}

export function cpSlice(s: string, start: number, end: number): string {
  return Array.from(s).slice(start, end).join('')
}

/** Q17's range rule: both null, or 0 <= start < end <= cpLength(content). */
export function validRange(content: string, start: number | null, end: number | null): boolean {
  if (start === null || end === null) return start === null && end === null
  return Number.isInteger(start) && Number.isInteger(end) && start >= 0 && start < end && end <= cpLength(content)
}

/** The text a quote points at: the slice, or the whole message. */
export function quotedText(content: string, start: number | null, end: number | null): string {
  return start === null || end === null ? content : cpSlice(content, start, end)
}
