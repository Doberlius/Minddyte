import { beforeEach, describe, expect, it } from 'vitest'
import { countRows, truncateAll } from '../helpers/pglite'
import {
  createChat, deleteChat, listChats, loadChat, loadGraph, renameChat, sessionExists,
} from '@/services/dbApi'
import { ingestUserMessage, persistMessage } from '@/services/graph'
import { retrieveContext } from '@/services/retrieval'
import { getDb, nodes, collections, rejectedPhrases, clusterOrigins } from '../../db'
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

  it("never hands back workspaceId as part of a chat", async () => {
    // GET /api/sessions/[id] does `Response.json(chat)` — whatever loadChat
    // returns goes straight into a response body a browser's own JS can
    // read. workspaceId is the one thing that must never be in that set: it
    // is the entire authorization secret the HttpOnly cookie exists to keep
    // away from client JS in the first place. This fails the moment someone
    // drops the `columns` clause and goes back to an unqualified findFirst.
    const a = await createChat(A)
    await say(A, a.id, 'PostgreSQL in production.')

    const chat = await loadChat(A, a.id)

    expect(chat).toBeDefined()
    expect(Object.keys(chat!)).not.toContain('workspaceId')
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
    // Guards a real property: deleting A's chat leaves B's postgresql node
    // at its own count. It does NOT prove the repair statements' own
    // `eq(nodes.workspaceId, workspaceId)` filter — delete that filter from
    // both of deleteChat's repair statements and this test stays green,
    // because `touched` is read via session_nodes for a session the DELETE
    // above already proved belongs to this workspace, so under today's
    // correct writes it can never hold a foreign node id for the filter to
    // catch. The filter earns its place anyway (see dbApi.ts's own comment
    // on deleteChat): it is what stops the repair from reaching a
    // stranger's row AT ALL, in the one case — a bug elsewhere — where
    // `touched` ever did hold one, rather than relying on that never
    // happening.
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

describe('text reach stays inside the workspace', () => {
  it("never reaches another workspace's passages", async () => {
    const b1 = await createChat(B)
    const mB = await persistMessage({ workspaceId: B, sessionId: b1.id, role: 'user', content: 'Defaults?' })
    const aB = await persistMessage({ workspaceId: B, sessionId: b1.id, role: 'assistant', content: 'The retention period for audit logs is ninety days by default.' })
    await ingestUserMessage({ workspaceId: B, sessionId: b1.id, messageId: mB, content: 'Defaults?', assistantContent: 'The retention period for audit logs is ninety days by default.', assistantMessageId: aB })

    const a1 = await createChat(A)
    const { chats } = await retrieveContext({
      workspaceId: A, sessionId: a1.id, mode: 'explore', taggedChatIds: [],
      draftText: 'What is our retention period for audit logs?',
    })
    expect(chats).toEqual([])
  })
})

describe('ownership guards on the write path', () => {
  it('persistMessage refuses a sessionId that belongs to a different workspace', async () => {
    // `messages` carries no workspace_id of its own — this ownership check
    // in persistMessage is the ONLY thing stopping a foreign sessionId from
    // writing into another workspace's chat. Deleting
    // `eq(sessions.workspaceId, input.workspaceId)` from that check leaves
    // the rest of the suite green, because nothing else exercises a
    // mismatched (workspaceId, sessionId) pair.
    const a = await createChat(A)

    await expect(
      persistMessage({ workspaceId: B, sessionId: a.id, role: 'user', content: 'Taken over' }),
    ).rejects.toThrow()

    // "Not yours" and "not there" must be indistinguishable from outside —
    // checked here as "nothing got written", not by inspecting the message.
    const chat = await loadChat(A, a.id)
    expect(chat!.messages).toHaveLength(0)
  })

  it('ingestUserMessage refuses a sessionId that belongs to a different workspace', async () => {
    // `upsertNodeAndLink` trusts the sessionId it is handed; nothing inside
    // ingestUserMessage's own transaction proved it belongs to workspaceId
    // before this guard existed. A mismatched pair here used to reach the
    // title/headline update, the compaction read and the compaction write —
    // three separately scoped `where` clauses, each individually deletable
    // with the rest of the suite staying green, because nothing else put a
    // mismatched pair through this function. This guard, and this test,
    // close that off at the one place a caller could ever reach it from.
    const a = await createChat(A)
    const messageId = await persistMessage({
      workspaceId: A, sessionId: a.id, role: 'user', content: 'We run PostgreSQL in production.',
    })

    await expect(
      ingestUserMessage({
        workspaceId: B, sessionId: a.id, messageId, content: 'We run PostgreSQL in production.',
      }),
    ).rejects.toThrow()

    // Title/headline still default — B's call never touched A's chat.
    const chat = await loadChat(A, a.id)
    expect(chat!.title).toBe('New Session')
    expect(chat!.headlineNodeId).toBeNull()

    // Pointers are written inside the same ownership check.
    expect(await countRows('chat_pointers')).toBe(0)
  })
})

describe('scoped tables nothing reads or writes yet', () => {
  // collections, rejected_phrases and cluster_origins each gained
  // workspace_id and had a global constraint scoped to it, ahead of
  // anything in the app actually using them. Without a test here, a future
  // regression back to the global constraint form (e.g. `unique(phrase)`
  // instead of `unique(workspace_id, phrase)`) would be silent — nothing
  // else in the suite inserts into these tables at all.

  it('lets two workspaces each feature a collection', async () => {
    const db = await getDb()
    await db.insert(collections).values({ workspaceId: A, title: 'Ops runbook', featured: true })
    await db.insert(collections).values({ workspaceId: B, title: 'Ops runbook', featured: true })

    const rows = await db.select().from(collections).where(eq(collections.featured, true))
    expect(rows).toHaveLength(2)
    expect(new Set(rows.map((r) => r.workspaceId))).toEqual(new Set([A, B]))
  })

  it('lets two workspaces each reject the same phrase', async () => {
    const db = await getDb()
    await db.insert(rejectedPhrases).values({ workspaceId: A, phrase: 'the thing' })
    await db.insert(rejectedPhrases).values({ workspaceId: B, phrase: 'the thing' })

    const rows = await db.select().from(rejectedPhrases).where(eq(rejectedPhrases.phrase, 'the thing'))
    expect(rows).toHaveLength(2)
    expect(new Set(rows.map((r) => r.workspaceId))).toEqual(new Set([A, B]))
  })

  it('lets two workspaces each place the same cluster key', async () => {
    const db = await getDb()
    await db.insert(clusterOrigins).values({ workspaceId: A, clusterKey: 'cluster-1', x: 10, y: 20 })
    await db.insert(clusterOrigins).values({ workspaceId: B, clusterKey: 'cluster-1', x: 30, y: 40 })

    const rows = await db.select().from(clusterOrigins).where(eq(clusterOrigins.clusterKey, 'cluster-1'))
    expect(rows).toHaveLength(2)
    expect(new Set(rows.map((r) => r.workspaceId))).toEqual(new Set([A, B]))
  })
})
