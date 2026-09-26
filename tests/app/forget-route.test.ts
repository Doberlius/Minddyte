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
