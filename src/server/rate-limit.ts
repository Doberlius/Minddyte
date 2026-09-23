import { allowance, prune, record, type Allowance, WINDOW_MS } from '@/lib/rate-limit'

/**
 * Who has spent what, held in this process's memory.
 *
 * In process, in a Map, and that is correct rather than lazy: the deployment
 * is pinned to one replica because PGlite holds its data directory
 * exclusively, so there is no second process for a shared store to
 * coordinate with. Redis here would be a dependency bought to solve a
 * problem the architecture has already ruled out.
 *
 * It is honest about its limit: restarting the container forgets every
 * counter. A deploy therefore hands everyone a fresh allowance, which is the
 * failure direction worth choosing — the alternative is a visitor locked out
 * by a counter from a container that no longer exists.
 */
const hits = new Map<string, number[]>()

/**
 * Entries whose requests have all aged out are dropped on a timer, not only
 * when their owner returns. Without this the map keeps one array per IP that
 * ever visited, forever, which is a slow leak that only shows up in
 * production and only after a good week.
 *
 * unref'd so it never by itself keeps the process alive.
 */
const SWEEP_MS = 5 * WINDOW_MS
const sweeper = setInterval(() => {
  const now = Date.now()
  for (const [key, times] of hits) {
    const live = prune(times, now)
    if (live.length === 0) hits.delete(key)
    else hits.set(key, live)
  }
}, SWEEP_MS)
sweeper.unref?.()

/**
 * The client's address, as far as it can be known behind a proxy.
 *
 * Railway and every other platform of its kind terminate TLS and forward the
 * original address in `x-forwarded-for`, so the socket's own address is the
 * proxy's and identical for everyone. The header is client-controlled and
 * therefore spoofable — which is why this limit is a budget guard, not a
 * security control, and why the message it produces never claims otherwise.
 *
 * The first entry is the original client; the rest are the proxies it passed
 * through.
 */
export function clientKey(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for')
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim()
    if (first) return first
  }
  return req.headers.get('x-real-ip')?.trim() || 'unknown'
}

/** What one more request would cost this caller, without charging for it. */
export function peek(key: string, now = Date.now()): Allowance {
  return allowance(hits.get(key) ?? [], now)
}

/** Charges one request. Call only after `peek` allowed it. */
export function charge(key: string, now = Date.now()): void {
  hits.set(key, record(hits.get(key) ?? [], now))
}

/**
 * The headers every chat response carries, allowed or refused.
 *
 * Put on the SUCCESS path too, on purpose: it means the gauge in the UI
 * updates from the reply the visitor was already waiting for, instead of
 * polling an endpoint to ask how much is left. A meter that costs a request
 * to read is a meter that changes what it measures.
 */
export function limitHeaders(v: Allowance): Record<string, string> {
  return {
    'X-RateLimit-Remaining': String(v.remaining),
    'X-RateLimit-Reset': String(Math.ceil(v.resetInMs / 1000)),
  }
}

/** Test seam. Nothing in the app calls this. */
export function __reset(): void {
  hits.clear()
}
