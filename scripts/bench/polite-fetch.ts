// One polite way to download, for the benchmark corpus (fetch-corpus.ts).
//  - Every request waits `gapMs` after the one before it, whatever happened to
//    that one (a failure, an error page): the gap is kept here, not by callers.
//  - A "slow down" answer (429 Too Many Requests, 503 Service Unavailable) is
//    retried after the wait its Retry-After header asks for, or after an
//    exponential backoff when it names none, up to `tries` requests in all.
//    The last answer is returned as it is, so the caller sees the failure.

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Retry-After as milliseconds: seconds, or an HTTP date; null when absent or unreadable. */
function retryAfterMs(res: Response): number | null {
  const v = res.headers.get('retry-after')
  if (v === null) return null
  if (/^\d+$/.test(v.trim())) return Number(v) * 1000
  const at = Date.parse(v)
  return Number.isNaN(at) ? null : Math.max(0, at - Date.now())
}

export function politeFetcher(opts: { userAgent: string; gapMs: number; tries?: number; maxWaitMs?: number }) {
  const tries = opts.tries ?? 4
  const maxWaitMs = opts.maxWaitMs ?? 60_000
  let last = -Infinity
  return async function get(url: string): Promise<Response> {
    for (let attempt = 1; ; attempt++) {
      const wait = last + opts.gapMs - Date.now()
      if (wait > 0) await sleep(wait)
      last = Date.now()
      const res = await fetch(url, { headers: { 'User-Agent': opts.userAgent } })
      if ((res.status !== 429 && res.status !== 503) || attempt >= tries) return res
      await res.body?.cancel()
      await sleep(Math.min(maxWaitMs, retryAfterMs(res) ?? opts.gapMs * 2 ** attempt))
    }
  }
}
