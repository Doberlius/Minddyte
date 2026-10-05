import { beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { getDb, messages } from '../../db'
import { FIXTURE_WORKSPACE_ID, newChat, truncateAll } from '../helpers/pglite'
import { persistMessage } from '@/services/graph'
import { newWorkspaceId } from '@/lib/workspace'
import { planTurn } from '@/services/turns'

beforeEach(truncateAll)
const ws = FIXTURE_WORKSPACE_ID

let clock = Date.UTC(2026, 0, 1)
beforeEach(() => { clock = Date.UTC(2026, 0, 1) })
async function save(sessionId: string, role: 'user' | 'assistant', content: string) {
  const id = await persistMessage({ workspaceId: ws, sessionId, role, content })
  await (await getDb()).update(messages).set({ createdAt: new Date((clock += 1000)) }).where(eq(messages.id, id))
  return id
}
async function threeTurns() {
  const chat = await newChat()
  const ids: string[] = []
  for (let n = 1; n <= 3; n++) {
    ids.push(await save(chat, 'user', `Question ${n}`))
    ids.push(await save(chat, 'assistant', `Answer ${n}`))
  }
  return { chat, ids } // [u1, a1, u2, a2, u3, a3]
}
const count = async () => (await (await getDb()).select().from(messages)).length

describe('planTurn', () => {
  it('is a new turn when no message is named', async () => {
    const { chat, ids } = await threeTurns()
    expect(await planTurn(ws, chat, { trigger: 'submit-message', lastId: ids[4] })).toEqual({ kind: 'new' })
  })

  it('cuts an edited message and everything after it', async () => {
    const { chat, ids } = await threeTurns()
    expect(await planTurn(ws, chat, { trigger: 'submit-message', messageId: ids[2], lastId: ids[2], expectCut: ids.slice(2) }))
      .toEqual({ kind: 'edit', cut: ids.slice(2) })
  })

  it('cuts a regenerated reply and everything after it', async () => {
    const { chat, ids } = await threeTurns()
    expect(await planTurn(ws, chat, { trigger: 'regenerate-message', messageId: ids[1], lastId: ids[0], expectCut: ids.slice(1) }))
      .toEqual({ kind: 'regenerate', cut: ids.slice(1) })
  })

  it('refuses to edit a model reply (Q3)', async () => {
    const { chat, ids } = await threeTurns()
    expect(await planTurn(ws, chat, { trigger: 'submit-message', messageId: ids[1], lastId: ids[1], expectCut: ids.slice(1) }))
      .toMatchObject({ kind: 'refused', status: 400 })
  })

  it('refuses an edit whose message is not the one sent', async () => {
    const { chat, ids } = await threeTurns()
    expect(await planTurn(ws, chat, { trigger: 'submit-message', messageId: ids[2], lastId: ids[0], expectCut: ids.slice(2) }))
      .toMatchObject({ kind: 'refused', status: 400 })
  })

  it('refuses to regenerate your own message, or a reply whose question was not sent', async () => {
    const { chat, ids } = await threeTurns()
    expect(await planTurn(ws, chat, { trigger: 'regenerate-message', messageId: ids[2], lastId: ids[2], expectCut: ids.slice(2) }))
      .toMatchObject({ kind: 'refused', status: 400 })
    expect(await planTurn(ws, chat, { trigger: 'regenerate-message', messageId: ids[3], lastId: ids[0], expectCut: ids.slice(3) }))
      .toMatchObject({ kind: 'refused', status: 400 })
  })

  it('answers 404 for a message the server does not have, another chat’s, or another workspace’s', async () => {
    const { chat, ids } = await threeTurns()
    const other = await newChat()
    const foreign = await save(other, 'user', 'Elsewhere')
    const unknown = '0b6f7c1e-8a4d-4f7a-9c2e-3d5b6a7c8d9e'
    for (const [sid, id, w] of [[chat, unknown, ws], [chat, foreign, ws], [chat, ids[2], newWorkspaceId()]] as const) {
      const plan = await planTurn(w, sid, { trigger: 'submit-message', messageId: id, lastId: id, expectCut: [id] })
      expect(plan).toEqual({
        kind: 'refused', status: 404, error: 'message_not_found',
        message: 'This message isn’t saved yet, or was deleted. Reload the chat, then try again.',
      })
    }
  })

  it('refuses a message id or trigger that is not a string it knows', async () => {
    const { chat, ids } = await threeTurns()
    expect(await planTurn(ws, chat, { trigger: 'submit-message', messageId: 42, lastId: ids[0] })).toMatchObject({ kind: 'refused', status: 400 })
    expect(await planTurn(ws, chat, { trigger: 'resume-stream', lastId: ids[0] })).toMatchObject({ kind: 'refused', status: 400 })
  })

  describe('expectCut: what this browser shows from the target on (final review F1)', () => {
    const CHANGED = {
      kind: 'refused', status: 409, error: 'chat_changed',
      message: 'This chat changed in another tab. Reload it, then try again.',
    }

    it('plans an edit when expectCut is the cut', async () => {
      const { chat, ids } = await threeTurns()
      expect(await planTurn(ws, chat, { trigger: 'submit-message', messageId: ids[2], lastId: ids[2], expectCut: ids.slice(2) }))
        .toEqual({ kind: 'edit', cut: ids.slice(2) })
    })

    it('refuses an edit with 409 when the database has a turn this browser never showed', async () => {
      const { chat, ids } = await threeTurns()
      const shown = ids.slice(2)
      await save(chat, 'user', 'Question 4, from another tab')
      await save(chat, 'assistant', 'Answer 4')
      expect(await planTurn(ws, chat, { trigger: 'submit-message', messageId: ids[2], lastId: ids[2], expectCut: shown }))
        .toEqual(CHANGED)
    })

    it('refuses a regenerate with 409 when the database has a turn this browser never showed', async () => {
      const { chat, ids } = await threeTurns()
      const shown = ids.slice(5)
      await save(chat, 'user', 'Question 4, from another tab')
      await save(chat, 'assistant', 'Answer 4')
      expect(await planTurn(ws, chat, { trigger: 'regenerate-message', messageId: ids[5], lastId: ids[4], expectCut: shown }))
        .toEqual(CHANGED)
    })

    it('refuses an edit with no expectCut, or a malformed one, with 400', async () => {
      const { chat, ids } = await threeTurns()
      for (const expectCut of [undefined, 'nope', [1, 2], null]) {
        expect(await planTurn(ws, chat, { trigger: 'submit-message', messageId: ids[2], lastId: ids[2], expectCut }))
          .toEqual({ kind: 'refused', status: 400, error: 'bad_request', message: 'Reload the chat, then try again.' })
      }
    })
  })

  it('writes nothing', async () => {
    const { chat, ids } = await threeTurns()
    const before = await count()
    await planTurn(ws, chat, { trigger: 'submit-message', messageId: ids[2], lastId: ids[2], expectCut: ids.slice(2) })
    await planTurn(ws, chat, { trigger: 'regenerate-message', messageId: ids[1], lastId: ids[0], expectCut: ids.slice(1) })
    expect(await count()).toBe(before)
  })
})
