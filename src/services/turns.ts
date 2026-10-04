import { and, asc, eq, inArray } from 'drizzle-orm'
import { getDb, messages, sessionNodes, sessions } from '../../db'
import { recountNodes, rejectedKeys, relinkChat, type Tx } from './links'

/**
 * Message-actions ticket 01, Q4: a turn is a user message and the assistant
 * message DIRECTLY after it. A user message whose send failed has no reply,
 * so it is a turn on its own, and the reply of the turn after it is never
 * taken with it. `all` is the chat's messages in order.
 */
export function turnAt(all: { id: string; role: string }[], i: number): string[] {
  const m = all[i]
  if (m.role === 'user') return all[i + 1]?.role === 'assistant' ? [m.id, all[i + 1].id] : [m.id]
  return all[i - 1]?.role === 'user' ? [all[i - 1].id, m.id] : [m.id]
}

/**
 * Delete the turn holding `messageId`, and everything memory built from it
 * (Q6): the cascade removes its pointers and message_nodes, relinkChat
 * rebuilds this chat's concept links from what remains, recountNodes fixes
 * chat_count and deletes concepts no chat holds, and the headline is
 * re-derived. The title never changes (Q12); an emptied chat stays (Q13).
 *
 * Returns the deleted ids in chat order, or null when the chat is not this
 * workspace's or the message is not in it — the same answer for both, so it
 * cannot be used to ask whether an id exists elsewhere. One transaction.
 */
export async function deleteTurn(workspaceId: string, sessionId: string, messageId: string): Promise<string[] | null> {
  const db = await getDb()
  return db.transaction(async (tx) => {
    const [owned] = await tx
      .select({ id: sessions.id })
      .from(sessions)
      .where(and(eq(sessions.id, sessionId), eq(sessions.workspaceId, workspaceId)))
    if (!owned) return null

    const all = await tx
      .select({ id: messages.id, role: messages.role })
      .from(messages)
      .where(eq(messages.sessionId, sessionId))
      .orderBy(asc(messages.createdAt), asc(messages.id))
    const i = all.findIndex((m) => m.id === messageId)
    if (i === -1) return null
    const turn = turnAt(all, i)

    await removeMessages(tx, workspaceId, sessionId, turn)
    return turn
  })
}

/**
 * Remove these messages of one chat, and everything memory built from them
 * (Q6), inside the caller's transaction. Shared by deleteTurn (ticket 01) and
 * ticket 02's edit/regenerate swap. The caller has already proved the chat is
 * this workspace's and that every id belongs to it.
 */
export async function removeMessages(tx: Tx, workspaceId: string, sessionId: string, ids: string[]): Promise<void> {
  // Read BEFORE the delete: afterwards nothing points at these concepts.
  const held = await tx.select({ nodeId: sessionNodes.nodeId }).from(sessionNodes).where(eq(sessionNodes.sessionId, sessionId))
  await tx.delete(messages).where(inArray(messages.id, ids))
  const touched = await relinkChat(tx, workspaceId, sessionId, await rejectedKeys(tx, workspaceId))
  await recountNodes(tx, workspaceId, [...new Set([...held.map((h) => h.nodeId), ...touched])])
}
