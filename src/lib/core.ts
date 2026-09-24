import { PROVISIONAL } from './provisional'

/**
 * The standing rule for Core: never destroy what someone typed. A save over
 * the cap is REJECTED with a plain message, never truncated — so the caller
 * must check this BEFORE writing anything, and the previous text stays
 * exactly as it was.
 */
export function validateCore(text: string): { ok: true } | { ok: false; message: string } {
  if (text.length <= PROVISIONAL.coreCharLimit) return { ok: true }
  const over = text.length - PROVISIONAL.coreCharLimit
  return {
    ok: false,
    message: `That's ${over} character${over === 1 ? '' : 's'} too long. "About you" can hold up to ${PROVISIONAL.coreCharLimit.toLocaleString('en-US')} characters.`,
  }
}
