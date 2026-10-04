import { and, eq } from 'drizzle-orm'
import { messages, sessions } from '../../db/schema'
import { recountNodes, rejectedKeys, relinkChat, type Tx } from './links'

/**
 * Re-run today's extractor over every stored USER message and bring each
 * chat's links in line with it (ticket 10, carrying ticket 12's Q4).
 *
 * Extraction fixes (ticket 11's comma split, ticket 12's leading verb) change
 * what a message yields, but a database that already ran keeps the old,
 * dead keys. messages.content is the source of truth, so this is
 * deterministic, like 0001_backfill_chat_pointers. Each future extraction
 * fix appends one more step that calls this.
 *
 * Per chat: links the extractor no longer yields are removed; links it now
 * yields are added. A concept forgotten in the chat is never linked (Q4). A
 * phrase rejected account-wide is never ADDED, and an existing link for it is
 * left alone: removing those is the review screen's job, not a migration's.
 * Existing links are not touched, so their last_referenced_at stays as it was.
 * Every headline is re-derived by the Q13 rule, which gives the same answer as
 * before for any chat the fixes did not change. Every concept it deletes is
 * logged: never destroy silently. The per-chat work is `relinkChat` (links.ts),
 * shared with deleteTurn. Chats with no user messages are skipped, as before.
 */
export async function reextractNodes(tx: Tx): Promise<void> {
  const chats = await tx
    .select({ id: sessions.id, workspaceId: sessions.workspaceId })
    .from(sessions)
    .orderBy(sessions.createdAt, sessions.id)

  const touched = new Map<string, Set<string>>()
  const rejectedByWorkspace = new Map<string, Set<string>>()

  for (const chat of chats) {
    const [hasUser] = await tx
      .select({ id: messages.id })
      .from(messages)
      .where(and(eq(messages.sessionId, chat.id), eq(messages.role, 'user')))
      .limit(1)
    if (!hasUser) continue
    let rejected = rejectedByWorkspace.get(chat.workspaceId)
    if (!rejected) {
      rejected = await rejectedKeys(tx, chat.workspaceId)
      rejectedByWorkspace.set(chat.workspaceId, rejected)
    }
    const set = touched.get(chat.workspaceId) ?? new Set<string>()
    for (const id of await relinkChat(tx, chat.workspaceId, chat.id, rejected)) set.add(id)
    touched.set(chat.workspaceId, set)
  }

  for (const [workspaceId, ids] of touched) {
    for (const label of await recountNodes(tx, workspaceId, [...ids])) {
      console.warn(`[migrate] removed the concept "${label}": no chat holds it any more`)
    }
  }
}
