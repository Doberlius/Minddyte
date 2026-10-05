import { and, asc, eq, inArray } from 'drizzle-orm'
import { getDb, messages, sessionNodes, sessions } from '../../db'
import { recountNodes, rejectedKeys, relinkChat, type Tx } from './links'
import { deriveTitle } from '@/lib/text'
import { stripVisualize } from '@/lib/scene/intent'
import { isUuidV4 } from '@/lib/workspace'

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
 * re-derived. A title the user chose never changes (Q12); an automatic one
 * follows the first message (see `retitle`). An emptied chat stays (Q13).
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
  // Read BEFORE the delete: afterwards nothing points at these concepts, and
  // the first message the title may have been made from is gone.
  const held = await tx.select({ nodeId: sessionNodes.nodeId }).from(sessionNodes).where(eq(sessionNodes.sessionId, sessionId))
  const oldFirst = await firstUserMessage(tx, sessionId)
  await tx.delete(messages).where(inArray(messages.id, ids))
  if (oldFirst && ids.includes(oldFirst.id)) await retitle(tx, sessionId, oldFirst.content)
  const touched = await relinkChat(tx, workspaceId, sessionId, await rejectedKeys(tx, workspaceId))
  await recountNodes(tx, workspaceId, [...new Set([...held.map((h) => h.nodeId), ...touched])])
}

async function firstUserMessage(tx: Tx, sessionId: string) {
  const [first] = await tx
    .select({ id: messages.id, content: messages.content })
    .from(messages)
    .where(and(eq(messages.sessionId, sessionId), eq(messages.role, 'user')))
    .orderBy(asc(messages.createdAt), asc(messages.id))
    .limit(1)
  return first
}

/**
 * The first message went (the user's answer to ticket 01's final review,
 * option a). A title still equal to what ingest made from it IS that text,
 * and titles reach other chats as memory, so it follows the new first message
 * — or goes back to the new-chat name when none is left. A title the user
 * chose is left alone. Made from the message as ingest read it: without a
 * leading `/visualize` command.
 */
async function retitle(tx: Tx, sessionId: string, oldFirstContent: string): Promise<void> {
  const [chat] = await tx.select({ title: sessions.title }).from(sessions).where(eq(sessions.id, sessionId))
  if (chat?.title !== deriveTitle(stripVisualize(oldFirstContent))) return
  const next = await firstUserMessage(tx, sessionId)
  await tx
    .update(sessions)
    .set({ title: deriveTitle(stripVisualize(next?.content ?? '')) })
    .where(eq(sessions.id, sessionId))
}

export type TurnPlan =
  | { kind: 'new' }
  | { kind: 'edit' | 'regenerate'; cut: string[] }
  | { kind: 'refused'; status: 400 | 404 | 409; error: string; message: string }

const NOT_FOUND: TurnPlan = {
  kind: 'refused', status: 404, error: 'message_not_found',
  message: 'This message isn’t saved yet, or was deleted. Reload the chat, then try again.',
}
const CHAT_CHANGED: TurnPlan = {
  kind: 'refused', status: 409, error: 'chat_changed',
  message: 'This chat changed in another tab. Reload it, then try again.',
}
const refuse = (message: string): TurnPlan => ({ kind: 'refused', status: 400, error: 'bad_request', message })

/**
 * What a chat request is (message-actions ticket 02), read from AI SDK's
 * `trigger` and `messageId`: a new turn; an edit (`submit-message` naming
 * your own message, which the browser keeps under the same id); or a
 * regenerate (`regenerate-message` naming a reply). For an edit or a
 * regenerate, `cut` is that message and everything after it — removed only
 * when the new reply is saved (Q9). Writes nothing. Only your own messages
 * can be edited (Q3). "Not yours" and "not there" give the same 404.
 *
 * `expectCut` is the cut as the browser shows it (final review F1): its
 * warning and confirm counted those messages. If another tab added or removed
 * any, the cut here differs and the request is refused with 409, rather than
 * removing messages nobody was warned about.
 */
export async function planTurn(
  workspaceId: string,
  sessionId: string,
  req: { trigger?: unknown; messageId?: unknown; lastId: string; expectCut?: unknown },
): Promise<TurnPlan> {
  const trigger = req.trigger ?? 'submit-message'
  if (trigger !== 'submit-message' && trigger !== 'regenerate-message') return refuse('That kind of request is not supported.')
  if (req.messageId == null) {
    return trigger === 'submit-message' ? { kind: 'new' } : refuse('Say which reply to regenerate.')
  }
  if (typeof req.messageId !== 'string') return refuse('A message id must be text.')
  const expectCut = req.expectCut
  if (!Array.isArray(expectCut) || !expectCut.every((id) => typeof id === 'string')) return refuse('Reload the chat, then try again.')
  if (!isUuidV4(req.messageId)) return NOT_FOUND

  const db = await getDb()
  const [owned] = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(and(eq(sessions.id, sessionId), eq(sessions.workspaceId, workspaceId)))
  if (!owned) return NOT_FOUND
  const all = await db
    .select({ id: messages.id, role: messages.role })
    .from(messages)
    .where(eq(messages.sessionId, sessionId))
    .orderBy(asc(messages.createdAt), asc(messages.id))
  const i = all.findIndex((m) => m.id === req.messageId)
  if (i === -1) return NOT_FOUND
  const cut = all.slice(i).map((m) => m.id)
  const changed = cut.length !== expectCut.length || cut.some((id, n) => id !== expectCut[n])

  if (trigger === 'submit-message') {
    if (all[i].role !== 'user') return refuse('Only your own messages can be edited.')
    if (req.messageId !== req.lastId) return refuse('The edited message must be the one sent.')
    return changed ? CHAT_CHANGED : { kind: 'edit', cut }
  }
  if (all[i].role !== 'assistant') return refuse('Only a reply can be regenerated.')
  if (all[i - 1]?.role !== 'user' || all[i - 1].id !== req.lastId) return refuse('The question for this reply must be the last message sent.')
  return changed ? CHAT_CHANGED : { kind: 'regenerate', cut }
}
