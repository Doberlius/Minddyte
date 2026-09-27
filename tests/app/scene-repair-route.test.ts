import { describe, expect, it } from 'vitest'
import { POST } from '@/app/api/scene/repair/route'

const post = (body: unknown) =>
  POST(new Request('http://localhost/api/scene/repair', { method: 'POST', headers: { 'content-type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) }))

describe('the repair route with a bad body', () => {
  it.each([['not json'], [{}], [{ blockIndex: 0, error: 'x' }]])('answers 400 for %j', async (body) => {
    const res = await post(body)
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'bad_request' })
  })
})
