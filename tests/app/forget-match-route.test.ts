import { describe, expect, it } from 'vitest'
import { POST } from '@/app/api/sessions/[id]/forget/match/route'

/**
 * Called directly, the way forget-route.test.ts does: the id and body checks
 * run before the workspace cookie is read.
 */
const params = (id: string) => ({ params: Promise.resolve({ id }) })
const UUID = '0b6f7c1e-8a4d-4f7a-9c2e-3d5b6a7c8d9e'

const post = (id: string, body: unknown, raw = false) =>
  POST(
    new Request('http://localhost/api/sessions/x/forget/match', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: raw ? (body as string) : JSON.stringify(body),
    }),
    params(id),
  )

describe('the forget match route', () => {
  it('answers 404 not_found for a malformed chat id', async () => {
    const res = await post("' or 1=1 --", { text: 'Kafka' })

    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'not_found' })
  })

  it('answers 400 when text is missing, not a string, or oversized', async () => {
    for (const body of [{}, null, 3, { text: 4 }, { text: ['a'] }, { text: 'x'.repeat(4001) }]) {
      const res = await post(UUID, body)
      expect(res.status, JSON.stringify(body)?.slice(0, 40)).toBe(400)
    }
  })

  it('answers 400 for a body that is not JSON', async () => {
    expect((await post(UUID, 'not json', true)).status).toBe(400)
  })
})
