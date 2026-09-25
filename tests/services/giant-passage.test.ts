import { beforeEach, describe, expect, it } from 'vitest'
import { getDb, chatPointers } from '../../db'
import { FIXTURE_WORKSPACE_ID as WS, newChat, truncateAll } from '../helpers/pglite'
import { ingestUserMessage, persistMessage } from '@/services/graph'
import { retrieveContext } from '@/services/retrieval'

beforeEach(truncateAll)

const QUESTION = 'Explain the Postgres query planner and its join strategies.' // strong phrases: "Postgres query planner", "join strategies"
const BIG = 'x '.repeat(100_000).trim() // 199,999 chars, no sentence break

async function timeToAsk(sessionId: string): Promise<number> {
  const t = Date.now()
  await retrieveContext({ workspaceId: WS, sessionId, mode: 'explore', taggedChatIds: [], draftText: QUESTION })
  return Date.now() - t
}

describe('one giant message never freezes retrieval (ticket 15)', () => {
  it('a giant message sent today is split, and a question stays fast', async () => {
    const a = await newChat('A')
    const messageId = await persistMessage({ workspaceId: WS, sessionId: a, role: 'user', content: BIG })
    await ingestUserMessage({ workspaceId: WS, sessionId: a, messageId, content: BIG })
    const b = await newChat('B')

    expect(await timeToAsk(b)).toBeLessThan(2000)
  }, 120_000)

  // Review Focus 2: pointers written BEFORE the fix are still one giant row,
  // for example on Render's disk before the migration runs. The guard alone must hold.
  it('a giant passage stored before the fix does not freeze a question', async () => {
    const a = await newChat('A')
    const messageId = await persistMessage({ workspaceId: WS, sessionId: a, role: 'user', content: BIG })
    const db = await getDb()
    await db.insert(chatPointers).values({
      workspaceId: WS, sessionId: a, messageId, ordinal: 0, kind: 'sentence', startChar: 0, endChar: BIG.length, matchText: BIG,
    })
    const b = await newChat('B')

    expect(await timeToAsk(b)).toBeLessThan(2000)
  }, 120_000)

  // Review Focus 3: the guard must never drop a real strong-phrase match.
  it('still finds a chat by an exact phrase', async () => {
    const c = await newChat('C')
    const messageId = await persistMessage({ workspaceId: WS, sessionId: c, role: 'user', content: 'The Postgres query planner picks a join strategy.' })
    await ingestUserMessage({ workspaceId: WS, sessionId: c, messageId, content: 'The Postgres query planner picks a join strategy.' })
    const b = await newChat('B')

    const { chats } = await retrieveContext({ workspaceId: WS, sessionId: b, mode: 'explore', taggedChatIds: [], draftText: QUESTION })

    expect(chats.map((x) => x.id)).toContain(c)
    expect(chats.find((x) => x.id === c)?.why).toContain('matches exact phrase "Postgres query planner"')
  })
})
