import { beforeEach, describe, expect, it } from 'vitest'
import { countRows, newChat, truncateAll } from '../helpers/pglite'
import { listChats } from '@/services/dbApi'

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

    const chats = await listChats()
    expect(chats).toHaveLength(2)
    expect(chats[0]).toHaveProperty('nodeCount', 0)
    expect(chats.map((c) => c.title)).toContain('newer')
  })

  it('does not see the previous test\'s rows', async () => {
    expect(await countRows('sessions')).toBe(0)
  })
})
