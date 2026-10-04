import { describe, expect, it } from 'vitest'
import { DELETE } from '@/app/api/sessions/[id]/messages/[messageId]/route'

const params = (id: string, messageId: string) => ({ params: Promise.resolve({ id, messageId }) })
const req = () => new Request('http://localhost/api/sessions/x/messages/y', { method: 'DELETE' })
const uuid = '0b6f7c1e-8a4d-4f7a-9c2e-3d5b6a7c8d9e'

describe('the delete-turn route with malformed ids', () => {
  it('answers 404 not_found for a chat id that is not a uuid', async () => {
    const res = await DELETE(req(), params('nope', uuid))
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'not_found' })
  })

  it('answers 404 not_found for a message id that is not a uuid', async () => {
    const res = await DELETE(req(), params(uuid, "' or 1=1 --"))
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'not_found' })
  })
})
