import { getDb, sessions, messages, nodes, sessionNodes } from "../../db"
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm"
import type { GraphNode, ViewGraph } from "@/types/graph"

/**
 * The whole graph, shaped for the Brain and the Archive.
 *
 * Two queries rather than one join: a join across sessions × session_nodes
 * would repeat every chat's compaction once per concept it holds, and the
 * compaction runs to 500 characters. The concepts are grouped in memory
 * instead, which is a few hundred rows at the sizes this product has.
 *
 * Archived concepts are left out. Forgetting exists so the graph stops showing
 * what you no longer use, and a canvas that draws them anyway would undo it.
 */
export async function loadGraph(workspaceId: string): Promise<ViewGraph> {
  const db = await getDb()

  const chatRows = await db
    .select({
      id: sessions.id,
      title: sessions.title,
      compaction: sessions.compaction,
    })
    .from(sessions)
    .where(eq(sessions.workspaceId, workspaceId))
    .orderBy(desc(sessions.updatedAt))

  /**
   * Counted by grouping rather than by a correlated subquery per chat.
   *
   * The subquery version returned 0 for every conversation while the messages
   * were plainly there — `loadChat` read eighteen of them from the same rows.
   * Rather than keep a construct that silently reported the wrong number, this
   * asks the question directly and is one query for the whole table.
   *
   * `array_agg(... order by ...)` gives the first message's length in the same
   * pass: the title is derived from that message and capped at 60 characters,
   * so a longer original is one that was cut, and the view needs to know in
   * order to print the ellipsis.
   */
  const perChat = await db
    .select({
      sessionId: messages.sessionId,
      messageCount: sql<number>`count(*)`.mapWith(Number),
      firstMessageLength:
        sql<number>`coalesce(length((array_agg(${messages.content} order by ${messages.createdAt} asc))[1]), 0)`.mapWith(
          Number,
        ),
    })
    .from(messages)
    // `messages` inherits its workspace through `sessions` and has no column
    // of its own, so the scope has to be fetched from where it does live. A
    // subquery here (rather than a join) keeps the shape of this query
    // unchanged, and putting it in the WHERE — rather than post-filtering in
    // JS — is what keeps another workspace's rows out of the result set
    // entirely, rather than merely out of the return value.
    .where(
      inArray(
        messages.sessionId,
        db.select({ id: sessions.id }).from(sessions).where(eq(sessions.workspaceId, workspaceId)),
      ),
    )
    .groupBy(messages.sessionId)

  const stats = new Map(perChat.map((row) => [row.sessionId, row]))

  const links = await db
    .select({
      key: nodes.canonicalKey,
      label: nodes.label,
      sessionId: sessionNodes.sessionId,
    })
    .from(sessionNodes)
    .innerJoin(nodes, eq(nodes.id, sessionNodes.nodeId))
    .where(and(eq(nodes.workspaceId, workspaceId), isNull(nodes.archivedAt)))

  const byKey = new Map<string, GraphNode>()
  for (const link of links) {
    const found = byKey.get(link.key)
    if (!found) {
      byKey.set(link.key, { key: link.key, label: link.label, chatIds: [link.sessionId] })
    } else if (!found.chatIds.includes(link.sessionId)) {
      found.chatIds.push(link.sessionId)
    }
  }

  return {
    chats: chatRows.map((c) => {
      const stat = stats.get(c.id)
      return {
        id: c.id,
        title: c.title,
        compaction: c.compaction,
        messageCount: stat?.messageCount ?? 0,
        titleTruncated: (stat?.firstMessageLength ?? 0) > c.title.length,
      }
    }),
    nodes: [...byKey.values()],
  }
}

export async function listChats(workspaceId: string) {
  const db = await getDb()
  return db
    .select({
      id: sessions.id,
      title: sessions.title,
      updatedAt: sessions.updatedAt,
      nodeCount: sql<number>`(
        select count(*) from ${sessionNodes} where ${sessionNodes.sessionId} = ${sessions.id}
      )`.mapWith(Number),
    })
    .from(sessions)
    .where(eq(sessions.workspaceId, workspaceId))
    .orderBy(desc(sessions.updatedAt))
}

export async function loadChat(workspaceId: string, sessionId: string) {
  const db = await getDb()
  return db.query.sessions.findFirst({
    where: and(eq(sessions.id, sessionId), eq(sessions.workspaceId, workspaceId)),
    // `workspaceId` never appears in a URL or a response body — that is the
    // whole point of keeping it in an HttpOnly cookie instead. GET
    // /api/sessions/[id] returns whatever this selects, verbatim, so an
    // unqualified findFirst here would hand a visitor's own authorization
    // secret to their own client JS (and anything that logs response
    // bodies) the moment they opened a chat. Named explicitly rather than
    // omitted-by-exception, so a column this doesn't ask for stays out by
    // default rather than by memory.
    columns: { id: true, title: true, compaction: true, headlineNodeId: true },
    with: { messages: { orderBy: messages.createdAt } },
  })
}

/**
 * A cheap existence check, not `loadChat` reused — the caller (POST
 * /api/chat) runs this on every message, and `loadChat` would drag in every
 * message row for a session that is almost always fine, just to answer yes/no.
 *
 * Why this needs to exist at all: `messages.session_id` is `notNull().references
 * (sessions.id)`, so inserting a message for an id the table doesn't have
 * raises a foreign-key violation. A browser can hold a sessionId for a chat
 * that is gone for several reasons — `db:reset`, a deleted chat, a restored
 * export — so the check has to happen before the insert, not just once at
 * `db:reset` time.
 */
export async function sessionExists(workspaceId: string, sessionId: string): Promise<boolean> {
  const db = await getDb()
  const row = await db.query.sessions.findFirst({
    where: and(eq(sessions.id, sessionId), eq(sessions.workspaceId, workspaceId)),
    columns: { id: true },
  })
  return row !== undefined
}

/**
 * Called only when the user actually SENDS in a new chat (ticket 08,
 * decision 2). Creating eagerly on "New chat" would leave a `New Session` row
 * behind every time someone opened one and walked away, and would then need a
 * guard to clean them up.
 *
 * `workspaceId` is a parameter, not read from a cookie in here — no service
 * function may find its own workspace, or a caller that forgets to pass one
 * would go unnoticed instead of failing to typecheck. `title` still defaults
 * to 'New Session', overwritten once by deriveTitle on the first message.
 */
export async function createChat(workspaceId: string): Promise<{ id: string }> {
  const db = await getDb()
  const [row] = await db.insert(sessions).values({ workspaceId }).returning({ id: sessions.id })
  return { id: row.id }
}

/**
 * Delete a chat, and repair what the foreign keys cannot.
 *
 * `messages`, `session_nodes` and the rest fall to `ON DELETE cascade`. The
 * part that needs code is `nodes.chat_count`: the write path only ever
 * increments it (`services/graph.ts`), so a cascade removes the link and
 * leaves the counter reading one chat too many — forever, and invisibly,
 * since nothing recomputes it. The canvas prints that number on every shared
 * concept, so a wrong one is not cosmetic.
 *
 * So the counter is rewritten from the links that actually remain, and a
 * concept no chat holds any more is removed outright: it can never be reached,
 * and a Node with a chat_count of 0 is not a concept, it is debris.
 *
 * Returns whether a chat was there to delete, so a caller can tell "done" from
 * "that had already gone".
 */
export async function deleteChat(workspaceId: string, sessionId: string): Promise<boolean> {
  const db = await getDb()

  // Which concepts this chat touched, read BEFORE the cascade takes the links
  // away — afterwards there is nothing left to point at them.
  const held = await db
    .select({ nodeId: sessionNodes.nodeId })
    .from(sessionNodes)
    .where(eq(sessionNodes.sessionId, sessionId))

  const deleted = await db
    .delete(sessions)
    .where(and(eq(sessions.id, sessionId), eq(sessions.workspaceId, workspaceId)))
    .returning({ id: sessions.id })

  if (deleted.length === 0) return false
  if (held.length === 0) return true

  const touched = held.map((h) => h.nodeId)

  // Recomputed from the links that survive rather than decremented, so a
  // counter that had already drifted is corrected instead of drifting further.
  //
  // `touched` node ids were read via session_nodes BEFORE we knew whether the
  // delete above would even touch this workspace's own session — but the
  // delete only succeeded (deleted.length > 0) when sessionId belonged to
  // workspaceId, so every id in `touched` is a node this workspace's own
  // link table pointed at. The workspace filter here is not for that: it is
  // what stops the recompute from REWRITING a stranger's node row even in the
  // (impossible under correct writes) case that `touched` ever held a
  // foreign node id — this repair is the one place in the file that WRITES
  // rows it did not look up by sessionId, so it gets its own explicit guard
  // rather than trusting the read above.
  await db
    .update(nodes)
    .set({
      chatCount: sql<number>`(
        select count(*) from ${sessionNodes} where ${sessionNodes.nodeId} = ${nodes.id}
      )`,
    })
    .where(and(inArray(nodes.id, touched), eq(nodes.workspaceId, workspaceId)))

  // A concept nothing holds any more is unreachable from every view. Left in
  // place it would sit in the mention picker as a name that opens nothing.
  // Same reasoning as the update above: scoped explicitly rather than trusted
  // from `touched`, because this DELETEs rows.
  await db
    .delete(nodes)
    .where(and(inArray(nodes.id, touched), eq(nodes.chatCount, 0), eq(nodes.workspaceId, workspaceId)))

  return true
}

/** A title long enough for any real name and short enough for the row. */
export const TITLE_CAP = 120

/**
 * Rename a chat.
 *
 * The title is normally derived ONCE, from the first user message, and never
 * recomputed (`services/graph.ts`, spec §4.4). That derivation caps at 60
 * characters and can land mid-clause, so this is the user's override of it —
 * and because the derivation is gated on the first message, a rename survives
 * everything said afterwards without any extra guard.
 *
 * It changes a label and nothing else. The Headline is a Node taken from the
 * ORIGINAL first message, and renaming is not a new concept.
 *
 * Returns false for a chat that is not there, and for a name that is only
 * whitespace — a blank rename is a slip, not an instruction to leave the row
 * unlabelled.
 */
export async function renameChat(workspaceId: string, sessionId: string, title: string): Promise<boolean> {
  const clean = title.trim().slice(0, TITLE_CAP)
  if (!clean) return false

  const db = await getDb()
  const updated = await db
    .update(sessions)
    .set({ title: clean, updatedAt: new Date() })
    .where(and(eq(sessions.id, sessionId), eq(sessions.workspaceId, workspaceId)))
    .returning({ id: sessions.id })

  return updated.length > 0
}
