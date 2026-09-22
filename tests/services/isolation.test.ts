import { beforeEach, describe, expect, it } from 'vitest'
import { truncateAll } from '../helpers/pglite'
import {
  createChat, deleteChat, listChats, loadChat, loadGraph, renameChat, sessionExists,
} from '@/services/dbApi'
import { ingestUserMessage, persistMessage } from '@/services/graph'
import { retrieveContext } from '@/services/retrieval'
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

describe('one workspace cannot see another', () => {
  it('lists only its own chats', async () => {
    const a = await createChat(A)
    await createChat(B)
    await say(A, a.id, 'PostgreSQL in production.')

    expect(await listChats(A)).toHaveLength(1)
    expect(await listChats(B)).toHaveLength(1)
    expect((await listChats(A))[0].id).toBe(a.id)
  })

  it('draws only its own graph', async () => {
    const a = await createChat(A)
    const b = await createChat(B)
    await say(A, a.id, 'PostgreSQL in production.')
    await say(B, b.id, 'Kafka handles event ordering.')

    const graph = await loadGraph(A)
    const labels = graph.nodes.map((n) => n.label.toLowerCase())

    expect(labels).toContain('postgresql')
    expect(labels).not.toContain('kafka')
  })

  it("counts only this workspace's messages, even for chats it cannot see", async () => {
    // Guards a real property: loadGraph(A) returns only A's chats, each
    // carrying A's own message count. It does NOT prove perChat's own
    // `inArray` filter — delete that filter and this test stays green,
    // because perChat groups by sessionId, a globally unique uuid, so B's
    // messages never land in A's group whether perChat itself is scoped or
    // not. The filter earns its place anyway: it keeps B's rows out of
    // perChat's own result set, so loadGraph's correctness stops resting on
    // the invariant the block below holds by convention — that `stats` is
    // only ever read via ids already drawn from the scoped chatRows —
    // rather than on the query itself.
    const a = await createChat(A)
    const b = await createChat(B)
    await say(A, a.id, 'PostgreSQL in production.')
    await say(B, b.id, 'Kafka handles event ordering.')
    await say(B, b.id, 'Kafka again, and again.')

    const graph = await loadGraph(A)

    expect(graph.chats).toHaveLength(1)
    expect(graph.chats[0].id).toBe(a.id)
    expect(graph.chats[0].messageCount).toBe(1)
  })

  it("will not open another workspace's chat", async () => {
    const a = await createChat(A)
    await say(A, a.id, 'PostgreSQL in production.')

    // Knowing the id is not enough. The id is a uuid in a URL the other
    // visitor's browser has; treating it as a capability would make every
    // shared link a way in.
    // findFirst returns undefined, not null, when nothing matches.
    expect(await loadChat(B, a.id)).toBeUndefined()
    expect(await sessionExists(B, a.id)).toBe(false)
  })

  it("will not delete another workspace's chat", async () => {
    const a = await createChat(A)

    expect(await deleteChat(B, a.id)).toBe(false)
    expect(await listChats(A)).toHaveLength(1)
  })

  it("will not rename another workspace's chat", async () => {
    const a = await createChat(A)
    await say(A, a.id, 'PostgreSQL in production.')
    const before = (await listChats(A))[0].title

    expect(await renameChat(B, a.id, 'Taken over')).toBe(false)
    expect((await listChats(A))[0].title).toBe(before)
  })

  it("deleting in one workspace leaves the other workspace's counts alone", async () => {
    // deleteChat repairs nodes.chat_count. That repair recomputes from
    // surviving links, so a repair that forgot its workspace would rewrite
    // a stranger's counter.
    const a = await createChat(A)
    const b = await createChat(B)
    await say(A, a.id, 'PostgreSQL in production.')
    await say(B, b.id, 'PostgreSQL in production.')

    await deleteChat(A, a.id)

    const db = await getDb()
    const rows = await db.select().from(nodes).where(eq(nodes.canonicalKey, 'postgresql'))
    expect(rows).toHaveLength(1)
    expect(rows[0].workspaceId).toBe(B)
    expect(rows[0].chatCount).toBe(1)
  })
})

describe('retrieval', () => {
  it('never reaches into another workspace, however much it shares', async () => {
    // Explore mode reaches chats "sharing a Node with the current Chat".
    // With a global node table that reach crossed workspaces, so a
    // stranger's conversation was handed to the model as this chat's own
    // memory. Nothing in the UI would have shown it.
    const a = await createChat(A)
    const b = await createChat(B)
    await say(A, a.id, 'PostgreSQL in production.')
    await say(B, b.id, 'PostgreSQL is what we use too, with a secret plan.')

    const a2 = await createChat(A)
    await say(A, a2.id, 'More about PostgreSQL.')

    const { chats } = await retrieveContext({
      workspaceId: A,
      sessionId: a2.id,
      mode: 'explore',
      taggedChatIds: [],
      draftText: 'PostgreSQL',
    })

    expect(chats.map((c) => c.id)).toContain(a.id)
    expect(chats.map((c) => c.id)).not.toContain(b.id)
  })

  it('will not bridge to a tagged chat from another workspace', async () => {
    // Tagging is uncapped and skips ranking, so it is the widest door in
    // the retrieval path — and taggedChatIds comes from the client.
    const a = await createChat(A)
    const b = await createChat(B)
    await say(B, b.id, 'A secret plan.')

    const { chats } = await retrieveContext({
      workspaceId: A,
      sessionId: a.id,
      mode: 'focus',
      taggedChatIds: [b.id],
      draftText: 'anything',
    })

    expect(chats).toHaveLength(0)
  })
})
