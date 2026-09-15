import { db, sessions, messages, nodes, sessionNodes } from "../../db"
import { desc, eq, inArray, sql } from "drizzle-orm"

export async function listChats() {
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
  return db.query.sessions.findFirst({
    where: eq(sessions.id, sessionId),
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
