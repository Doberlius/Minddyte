import { beforeEach, describe, expect, it } from 'vitest'
import { truncateAll } from '../helpers/pglite'
import { createChat } from '@/services/dbApi'
import { ingestUserMessage, persistMessage } from '@/services/graph'
import { getDb, nodes } from '../../db'
import { eq } from 'drizzle-orm'
import { newWorkspaceId } from '@/lib/workspace'

beforeEach(truncateAll)

const A = newWorkspaceId()
const B = newWorkspaceId()

async function say(workspaceId: string, sessionId: string, content: string) {
  const messageId = await persistMessage({ workspaceId, sessionId, role: 'user', content })
  await ingestUserMessage({ workspaceId, sessionId, messageId, content })
}

describe('two workspaces saying the same thing', () => {
  it('gets two node rows, not one', async () => {
    // THE test. `nodes_canonical_unique` used to be global, so both of
    // these inferred onto one row: session_nodes linked both chats to it,
    // chat_count counted across strangers, and the canvas drew an edge
    // between two people who have never met. The chat lists looked
    // correctly separated the entire time, which is why this needs a test
    // rather than a look.
    const a = await createChat(A)
    const b = await createChat(B)

    await say(A, a.id, 'We run PostgreSQL in production.')
    await say(B, b.id, 'We run PostgreSQL in production.')

    const db = await getDb()
    const rows = await db.select().from(nodes).where(eq(nodes.canonicalKey, 'postgresql'))

    expect(rows).toHaveLength(2)
    expect(new Set(rows.map((r) => r.workspaceId))).toEqual(new Set([A, B]))
  })

  it("counts each workspace's chats separately", async () => {
    const a1 = await createChat(A)
    const a2 = await createChat(A)
    const b1 = await createChat(B)

    await say(A, a1.id, 'We run PostgreSQL in production.')
    await say(A, a2.id, 'PostgreSQL again, in a second chat.')
    await say(B, b1.id, 'We run PostgreSQL in production.')

    const db = await getDb()
    const rows = await db.select().from(nodes).where(eq(nodes.canonicalKey, 'postgresql'))
    const counts = Object.fromEntries(rows.map((r) => [r.workspaceId, r.chatCount]))

    // Two chats in A, one in B. A global counter would read 3 for both.
    expect(counts[A]).toBe(2)
    expect(counts[B]).toBe(1)
  })
})
