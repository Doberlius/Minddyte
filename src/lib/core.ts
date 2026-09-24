import { PROVISIONAL } from './provisional'

/**
 * The standing rule for Core: never destroy what someone typed. A save over
 * the cap is REJECTED with a plain message, never truncated — so the caller
 * must check this BEFORE writing anything, and the previous text stays
 * exactly as it was.
 */
/**
 * The quiet second line under "About you" in the sidebar: when it was last
 * saved, in words a first-time visitor reads at once. Rough on purpose — a
 * note you wrote "3 days ago" does not need the hour. A date slightly in the
 * future (a clock a few seconds off) reads as "just now", never as nonsense.
 */
export function lastEditedLabel(updatedAt: Date | null, now: Date): string {
  if (!updatedAt) return 'Not written yet'
  const minutes = Math.floor((now.getTime() - updatedAt.getTime()) / 60_000)
  if (minutes < 1) return 'Edited just now'
  if (minutes < 60) return `Edited ${plural(minutes, 'minute')} ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `Edited ${plural(hours, 'hour')} ago`
  const days = Math.floor(hours / 24)
  if (days === 1) return 'Edited yesterday'
  if (days < 30) return `Edited ${days} days ago`
  if (days < 365) return `Edited ${plural(Math.floor(days / 30), 'month')} ago`
  return 'Edited over a year ago'
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

export function validateCore(text: string): { ok: true } | { ok: false; message: string } {
  if (text.length <= PROVISIONAL.coreCharLimit) return { ok: true }
  const over = text.length - PROVISIONAL.coreCharLimit
  return {
    ok: false,
    message: `That's ${over} character${over === 1 ? '' : 's'} too long. "About you" can hold up to ${PROVISIONAL.coreCharLimit.toLocaleString('en-US')} characters.`,
  }
}
