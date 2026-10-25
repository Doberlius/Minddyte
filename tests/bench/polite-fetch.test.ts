import { afterEach, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { politeFetcher } from '../../scripts/bench/polite-fetch'

/**
 * Final review, minor 10: the corpus download must stay polite even when
 * something goes wrong. Every request waits the gap after the one before
 * (a failed one too), and a "slow down" answer (429 or 503) is retried after
 * the wait the server asks for. Tested against a real local HTTP server.
 */
let server: Server | null = null
afterEach(() => new Promise<void>((r) => (server ? server.close(() => r()) : r())))

/** A server answering with `answers` in turn (the last one repeats); returns its URL and the arrival times. */
async function serve(answers: { status: number; retryAfter?: string }[]) {
  const arrivals: number[] = []
  server = createServer((_req, res) => {
    const a = answers[Math.min(arrivals.length, answers.length - 1)]
    arrivals.push(Date.now())
    res.writeHead(a.status, a.retryAfter === undefined ? {} : { 'Retry-After': a.retryAfter })
    res.end(String(a.status))
  })
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', () => r()))
  return { url: `http://127.0.0.1:${(server!.address() as AddressInfo).port}/`, arrivals }
}

describe('politeFetcher', () => {
  it('waits the gap before the next request, even after a failed one', async () => {
    const { url, arrivals } = await serve([{ status: 500 }, { status: 200 }])
    const get = politeFetcher({ userAgent: 'test', gapMs: 300, tries: 1 })
    expect((await get(url)).status).toBe(500)
    expect((await get(url)).status).toBe(200)
    expect(arrivals[1] - arrivals[0]).toBeGreaterThanOrEqual(290)
  })

  it('retries a 429 after the wait its Retry-After asks for', async () => {
    const { url, arrivals } = await serve([{ status: 429, retryAfter: '1' }, { status: 200 }])
    const get = politeFetcher({ userAgent: 'test', gapMs: 50, tries: 3 })
    expect((await get(url)).status).toBe(200)
    expect(arrivals).toHaveLength(2)
    expect(arrivals[1] - arrivals[0]).toBeGreaterThanOrEqual(990)
  })

  it('backs off on a 503 without Retry-After, and gives up after its tries', async () => {
    const { url, arrivals } = await serve([{ status: 503 }])
    const get = politeFetcher({ userAgent: 'test', gapMs: 50, tries: 3 })
    expect((await get(url)).status).toBe(503)
    expect(arrivals).toHaveLength(3)
    // Each wait is longer than the last (exponential backoff).
    expect(arrivals[2] - arrivals[1]).toBeGreaterThan(arrivals[1] - arrivals[0])
  })
})
