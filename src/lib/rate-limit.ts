/**
 * How much one visitor may spend, decided as a pure function over a clock.
 *
 * Kept pure because the interesting cases are all about time — a window that
 * slides, a slot that frees up, a burst that arrives in the same millisecond —
 * and a test that has to wait sixty seconds to check a sixty-second window
 * gets deleted by the first person in a hurry.
 *
 * The numbers are small on purpose. This protects a demo's budget, not a
 * product's capacity, and the person it must never inconvenience is someone
 * evaluating the work for two minutes.
 */

/** Ten requests per rolling minute, per IP. */
export const WINDOW_MS = 60_000
export const MAX_REQUESTS = 10

/**
 * The two length caps behave differently on purpose.
 *
 * A message over the cap is REFUSED: the visitor typed it, so they can
 * shorten it, and saying so costs them one edit.
 *
 * A request over the cap is TRIMMED instead, because most of its length is
 * memory the app chose to attach from other conversations. Refusing there
 * would punish someone for having a rich graph — the thing the product is
 * for — over a decision they never made.
 */
export const MAX_MESSAGE_CHARS = 2000
export const MAX_REQUEST_CHARS = 4000

export type Allowance = {
  allowed: boolean
  /** Requests left in the current window. Zero when refused. */
  remaining: number
  /**
   * Milliseconds until one more request becomes possible.
   *
   * With a sliding window there is no single moment when everything resets —
   * each request ages out one minute after it was made. So this is the wait
   * until the OLDEST request in the window expires, which is the first
   * instant a new one fits. Zero when nothing is waiting.
   */
  resetInMs: number
}

/**
 * Drops the timestamps that have aged out. Exported because the store needs
 * it to keep its map from growing forever, not only to answer a question.
 */
export function prune(hits: readonly number[], now: number): number[] {
  const cutoff = now - WINDOW_MS
  return hits.filter((t) => t > cutoff)
}

/**
 * Whether one more request fits, given the ones already made.
 *
 * `hits` are the timestamps of previous requests, in any order. This does not
 * record anything — deciding and recording are separate so that a request
 * refused for some other reason (a message over the cap, a missing session)
 * never costs the visitor a slot they did not use.
 */
export function allowance(hits: readonly number[], now: number): Allowance {
  const live = prune(hits, now)

  // Reported whether or not the window is full, because the moment someone
  // most wants it is BEFORE they run out. A meter that only says "22s" once
  // it is already refusing has withheld the one number that would have let
  // the visitor decide what to ask next.
  //
  // The first slot to come back is the oldest one, a window after it was
  // taken. Math.max keeps a clock that jumped backwards — an NTP correction,
  // a laptop waking up — from producing a negative wait that renders as
  // "resets in -3s".
  const resetInMs =
    live.length === 0 ? 0 : Math.max(0, Math.min(...live) + WINDOW_MS - now)

  if (live.length < MAX_REQUESTS) {
    return { allowed: true, remaining: MAX_REQUESTS - live.length - 1, resetInMs }
  }
  return { allowed: false, remaining: 0, resetInMs }
}

/** The timestamps after charging one request. Call only once it is allowed. */
export function record(hits: readonly number[], now: number): number[] {
  return [...prune(hits, now), now]
}

export type LengthCheck =
  | { ok: true }
  | { ok: false; reason: string }

/**
 * Whether a message may be sent at all.
 *
 * Standing rule: never fail blankly. The reason names the limit AND what the
 * visitor can do, because "too long" without a number leaves them guessing
 * how much to cut.
 */
export function checkMessage(text: string): LengthCheck {
  if (text.length <= MAX_MESSAGE_CHARS) return { ok: true }
  return {
    ok: false,
    reason:
      `That message is ${text.length.toLocaleString()} characters and the limit is ` +
      `${MAX_MESSAGE_CHARS.toLocaleString()}. Send the part you want an answer about — ` +
      'this instance runs on a fixed budget, so it keeps messages short rather than ' +
      'refusing people later in the day.',
  }
}

/**
 * How many characters of memory from other chats may be attached, once this
 * message has taken its share.
 *
 * Returns zero rather than a negative number: a long message spends the whole
 * request budget on itself, and the answer is then from this conversation
 * alone, which is a worse answer but still an answer.
 */
export function memoryBudget(messageChars: number): number {
  return Math.max(0, MAX_REQUEST_CHARS - messageChars)
}
