import { getDb, sessions, messages, nodes, sessionNodes } from "../../db"
import { desc, eq, inArray, sql } from "drizzle-orm"

export async function listChats() {
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
    .orderBy(desc(sessions.updatedAt))
}

export async function loadChat(sessionId: string) {
  const db = await getDb()
  return db.query.sessions.findFirst({
    where: eq(sessions.id, sessionId),
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
export async function sessionExists(sessionId: string): Promise<boolean> {
  const db = await getDb()
  const row = await db.query.sessions.findFirst({
    where: eq(sessions.id, sessionId),
    columns: { id: true },
  })
  return row !== undefined
}

export async function touchNodes(nodeIds: string[]) {
  if (nodeIds.length === 0) return
  const db = await getDb()
  await db
    .update(nodes)
    .set({ lastReferencedAt: new Date() })
    .where(inArray(nodes.id, nodeIds))
}

/**
 * Called only when the user actually SENDS in a new chat (ticket 08,
 * decision 2). Creating eagerly on "New chat" would leave a `New Session` row
 * behind every time someone opened one and walked away, and would then need a
 * guard to clean them up.
 *
 * No arguments: `user_id` is gone (ticket 03) and `title` defaults to
 * 'New Session', overwritten once by deriveTitle on the first message.
 */
export async function createChat(): Promise<{ id: string }> {
  const db = await getDb()
  const [row] = await db.insert(sessions).values({}).returning({ id: sessions.id })
  return { id: row.id }
}
