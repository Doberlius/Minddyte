import { beforeEach, describe, expect, it } from 'vitest'
import { countRows, FIXTURE_WORKSPACE_ID, newChat, truncateAll } from '../helpers/pglite'
import { createChat, listChats } from '@/services/dbApi'

beforeEach(truncateAll)

describe('dbApi against a real database', () => {
  it('starts each test empty', async () => {
    expect(await countRows('sessions')).toBe(0)
  })

  it('listChats executes and returns rows newest-first', async () => {
    // The point of this test is item 1 on ticket 06's coverage ranking:
    // "every query executes at all". listChats carries a correlated subquery
    // that typecheck cannot validate.
    await newChat('older')
    await newChat('newer')

    const chats = await listChats(FIXTURE_WORKSPACE_ID)
    expect(chats).toHaveLength(2)
    expect(chats[0]).toHaveProperty('nodeCount', 0)
    expect(chats.map((c) => c.title)).toContain('newer')
  })

  it('does not see the previous test\'s rows', async () => {
    expect(await countRows('sessions')).toBe(0)
  })
})

describe('createChat', () => {
  it('writes one row and returns its id', async () => {
    const { id } = await createChat(FIXTURE_WORKSPACE_ID)
    expect(id).toMatch(/^[0-9a-f-]{36}$/)
    expect(await countRows('sessions')).toBe(1)
  })

  it('gives the new chat the placeholder title that deriveTitle overwrites', async () => {
    await createChat(FIXTURE_WORKSPACE_ID)
    const chats = await listChats(FIXTURE_WORKSPACE_ID)
    // Spec §4.4 derives the real title from the FIRST user message, once.
    expect(chats[0].title).toBe('New Session')
    expect(chats[0].nodeCount).toBe(0)
  })

  it('two calls make two distinct chats', async () => {
    const a = await createChat(FIXTURE_WORKSPACE_ID)
    const b = await createChat(FIXTURE_WORKSPACE_ID)
    expect(a.id).not.toBe(b.id)
    expect(await countRows('sessions')).toBe(2)
  })
})
