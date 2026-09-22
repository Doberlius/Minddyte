import { beforeEach, describe, expect, it } from 'vitest'
import { countRows, truncateAll } from '../helpers/pglite'
import { createChat, deleteChat, listChats } from '@/services/dbApi'
import { persistMessage, ingestUserMessage } from '@/services/graph'
import { getDb, nodes } from '../../db'
import { eq } from 'drizzle-orm'
import { newWorkspaceId } from '@/lib/workspace'

beforeEach(truncateAll)

/**
 * Deleting a chat, against the real database.
 *
 * The rows a foreign key takes care of are the easy half. The half worth
 * testing is `nodes.chat_count`, which the write path only ever INCREMENTS
 * (`services/graph.ts`) — the cascade removes the `session_nodes` row and
 * leaves the counter behind, so without repair every delete inflates the
 * number the canvas prints on a concept, permanently and invisibly.
 */

// One workspace for the whole file — deleteChat's isolation ACROSS
// workspaces is isolation.test.ts's job. Here every chat shares one, so a
// two-chat test like "keeps a concept another chat still holds" still
// dedups onto the same node the way it did before workspaces existed.
const WORKSPACE_ID = newWorkspaceId()

/** Put a message through the real ingest path, so the graph is real. */
async function say(sessionId: string, content: string) {
  const messageId = await persistMessage({ workspaceId: WORKSPACE_ID, sessionId, role: 'user', content })
  await ingestUserMessage({ workspaceId: WORKSPACE_ID, sessionId, messageId, content })
}

async function countFor(key: string): Promise<number | null> {
  const db = await getDb()
  const row = await db.query.nodes.findFirst({ where: eq(nodes.canonicalKey, key) })
  return row ? row.chatCount : null
}

describe('deleteChat', () => {
  it('removes the chat', async () => {
    const { id } = await createChat(WORKSPACE_ID)
    await say(id, 'We run PostgreSQL in production.')

    await deleteChat(id)

    expect(await listChats()).toHaveLength(0)
  })

  it('takes its messages with it', async () => {
    const { id } = await createChat(WORKSPACE_ID)
    await say(id, 'We run PostgreSQL in production.')
    expect(await countRows('messages')).toBe(1)

    await deleteChat(id)

    expect(await countRows('messages')).toBe(0)
  })

  it('takes its links to concepts with it', async () => {
    const { id } = await createChat(WORKSPACE_ID)
    await say(id, 'We run PostgreSQL in production.')
    expect(await countRows('session_nodes')).toBeGreaterThan(0)

    await deleteChat(id)

    expect(await countRows('session_nodes')).toBe(0)
  })

  it('removes a concept no other chat holds', async () => {
    const { id } = await createChat(WORKSPACE_ID)
    await say(id, 'We run PostgreSQL in production.')
    expect(await countFor('postgresql')).toBe(1)

    await deleteChat(id)

    expect(await countFor('postgresql')).toBeNull()
  })

  it('keeps a concept another chat still holds', async () => {
    const a = await createChat(WORKSPACE_ID)
    const b = await createChat(WORKSPACE_ID)
    await say(a.id, 'We run PostgreSQL in production.')
    await say(b.id, 'Is PostgreSQL a good fit for a ledger?')
    expect(await countFor('postgresql')).toBe(2)

    await deleteChat(a.id)

    expect(await countFor('postgresql')).toBe(1)
  })

  it('brings chat_count back down, which the write path never does', async () => {
    // The whole reason this function is more than one DELETE. `chat_count` is
    // a denormalised counter that only ever goes up; a cascade would leave it
    // reading 2 for a concept one chat holds.
    const a = await createChat(WORKSPACE_ID)
    const b = await createChat(WORKSPACE_ID)
    const c = await createChat(WORKSPACE_ID)
    for (const chat of [a, b, c]) await say(chat.id, 'Kubernetes schedules it anyway.')
    expect(await countFor('kubernetes')).toBe(3)

    await deleteChat(a.id)
    await deleteChat(b.id)

    expect(await countFor('kubernetes')).toBe(1)
  })

  it('leaves the other chats alone', async () => {
    const a = await createChat(WORKSPACE_ID)
    const b = await createChat(WORKSPACE_ID)
    await say(a.id, 'We run PostgreSQL in production.')
    await say(b.id, 'Rust has no garbage collector.')

    await deleteChat(a.id)

    const left = await listChats()
    expect(left).toHaveLength(1)
    expect(left[0].id).toBe(b.id)
    expect(await countFor('rust')).toBe(1)
  })

  it('reports whether there was anything to delete', async () => {
    const { id } = await createChat(WORKSPACE_ID)

    expect(await deleteChat(id)).toBe(true)
    expect(await deleteChat(id)).toBe(false)
  })

  it('does not throw on an id that was never a chat', async () => {
    expect(await deleteChat('00000000-0000-0000-0000-000000000000')).toBe(false)
    expect(await countRows('sessions')).toBe(0)
  })
})
