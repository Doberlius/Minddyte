import { db, sessions, messages, nodes, sessionNodes } from "../../db"
import { and, desc, eq, inArray, sql } from "drizzle-orm"

export async function listChats(userId: string) {
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
    .where(eq(sessions.userId, userId))
    .orderBy(desc(sessions.updatedAt))
}

export async function loadChat(sessionId: string, userId: string) {
  return db.query.sessions.findFirst({
    where: and(eq(sessions.id, sessionId), eq(sessions.userId, userId)),
    with: { messages: { orderBy: messages.createdAt } },
  })
}

export async function touchNodes(nodeIds: string[]) {
  if (nodeIds.length === 0) return
  await db
    .update(nodes)
    .set({ lastReferencedAt: new Date() })
    .where(inArray(nodes.id, nodeIds))
}
