import { describe, expect, it } from 'vitest'
import { GET, POST } from '@/app/api/sessions/[id]/forget/route'

/**
 * Final review, fix 5: a chat id that is not a uuid used to reach Postgres,
 * which rejects it as a uuid and the route answered 500. It is a chat that
 * does not exist, so it gets the same 404 as one. The check runs before the
 * workspace cookie is read, which is why these can call the handlers directly.
 */
const params = (id: string) => ({ params: Promise.resolve({ id }) })

describe('the forget route with a malformed chat id', () => {
  it('GET answers 404 not_found', async () => {
    const res = await GET(new Request('http://localhost/api/sessions/nope/forget?key=kafka'), params('nope'))

    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'not_found' })
  })

  it('POST answers 404 not_found', async () => {
    const res = await POST(
      new Request('http://localhost/api/sessions/nope/forget', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key: 'kafka' }),
      }),
      params("' or 1=1 --"),
    )

    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'not_found' })
  })
})

describe('the forget route with malformed parts', () => {
  const post = (body: unknown) =>
    POST(
      new Request('http://localhost/api/sessions/x/forget', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
      params('0b6f7c1e-8a4d-4f7a-9c2e-3d5b6a7c8d9e'),
    )

  it('answers 400 when parts is not a list of words', async () => {
    for (const parts of ['Jobs', [1], Array.from({ length: 21 }, () => 'x'), ['x'.repeat(101)]]) {
      const res = await post({ key: 'stevejobs', parts })
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'parts must be a list of words' })
    }
  })
})
