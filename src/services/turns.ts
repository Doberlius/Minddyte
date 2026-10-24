import { and, asc, eq, inArray, isNotNull } from 'drizzle-orm'
import { getDb, messages, sessionNodes, sessions } from '../../db'
import { recountNodes, rejectedKeys, relinkChat, type Tx } from './links'
import { deriveTitle } from '@/lib/text'
import { stripVisualize } from '@/lib/scene/intent'
import { isUuidV4 } from '@/lib/workspace'
import { quotedText, validRange, type QuoteRef } from '@/lib/quote'
import type { QuoteForModel } from '@/lib/quote-prompt'

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
    const all = await ownedChatOrder(tx, workspaceId, sessionId)
    if (!all) return null
    const i = all.findIndex((m) => m.id === messageId)
    if (i === -1) return null
    const turn = turnAt(all, i)

    await removeMessages(tx, workspaceId, sessionId, turn)
    return turn
  })
}

/**
 * Remove a new turn's question whose reply never came, and everything memory
 * built from it. One transaction.
 *
 * Why it exists: a new turn saves its question BEFORE the model streams
 * (the chat route), so the browser can name it. When the send fails, the
 * browser takes the question back off the screen and puts its text back in
 * the box. The database must not keep a hidden copy of it: a resend would
 * duplicate it, `relinkChat` would build memory from it, and the next edit
 * would get a false 409 (its cut would include a message the browser never
 * showed).
 *
 * Only an unanswered question of this workspace's chat goes: it must be a
 * `user` message, and the message directly after it, in (created_at, id)
 * order, must not be an `assistant` one. So a question whose reply was saved
 * is never removed, whoever calls this. Returns true when it removed the
 * message; false, writing nothing, otherwise.
 */
export async function discardUnanswered(workspaceId: string, sessionId: string, messageId: string): Promise<boolean> {
  const db = await getDb()
  return db.transaction(async (tx) => {
    const all = await ownedChatOrder(tx, workspaceId, sessionId)
    if (!all) return false
    const i = all.findIndex((m) => m.id === messageId)
    if (i === -1 || all[i].role !== 'user' || all[i + 1]?.role === 'assistant') return false
    await removeMessages(tx, workspaceId, sessionId, [messageId])
    return true
  })
}

/** The chat's messages in turn order, or null when the chat is not this workspace's. */
async function ownedChatOrder(tx: Tx, workspaceId: string, sessionId: string) {
  const [owned] = await tx
    .select({ id: sessions.id })
    .from(sessions)
    .where(and(eq(sessions.id, sessionId), eq(sessions.workspaceId, workspaceId)))
  if (!owned) return null
  return tx
    .select({ id: messages.id, role: messages.role })
    .from(messages)
    .where(eq(messages.sessionId, sessionId))
    .orderBy(asc(messages.createdAt), asc(messages.id))
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

const BAD_QUOTE = { ok: false as const, message: 'That quote can’t be used. Remove it and try again.' }
const isOffset = (v: unknown): v is number | null => v === null || typeof v === 'number'

/**
 * Ticket 03: a quote sent with a message must name a message of THIS chat
 * with a valid range (Q17). Writes nothing. `null` (or nothing) is no quote.
 * Every refusal gives the same answer, so it cannot be used to ask whether a
 * message exists in another chat. Only the three quote fields are kept:
 * anything else the browser sent with it is dropped.
 *
 * `removing` is what this request removes when its reply is saved (an edit's
 * cut, `planTurn`). A quote of one of those would name a message that is gone
 * by then, or the edited message itself, so it is refused too.
 *
 * `editing` is the message an edit rewrites. An edit keeps its quote (Q23),
 * and that quote's target may have been deleted since (Q18): the exact quote
 * already saved on that message is accepted even then, so it still reads
 * "replying to a deleted message" afterwards.
 */
export async function checkQuote(
  workspaceId: string,
  sessionId: string,
  raw: unknown,
  removing: string[] = [],
  editing?: string,
): Promise<{ ok: true; quote: QuoteRef | null } | { ok: false; message: string }> {
  if (raw == null) return { ok: true, quote: null }
  if (typeof raw !== 'object' || Array.isArray(raw)) return BAD_QUOTE
  const { replyToId, start, end } = raw as Record<string, unknown>
  if (!isUuidV4(sessionId) || !isUuidV4(replyToId) || !isOffset(start) || !isOffset(end)) return BAD_QUOTE
  if (removing.includes(replyToId)) return BAD_QUOTE
  const db = await getDb()
  const [target] = await db
    .select({ content: messages.content })
    .from(messages)
    .innerJoin(sessions, eq(sessions.id, messages.sessionId))
    .where(and(eq(messages.id, replyToId), eq(messages.sessionId, sessionId), eq(sessions.workspaceId, workspaceId)))
  if (!target && editing && isUuidV4(editing)) {
    const [own] = await db
      .select({ replyToId: messages.replyToId, start: messages.quoteStart, end: messages.quoteEnd })
      .from(messages)
      .innerJoin(sessions, eq(sessions.id, messages.sessionId))
      .where(and(eq(messages.id, editing), eq(messages.sessionId, sessionId), eq(sessions.workspaceId, workspaceId)))
    if (own && own.replyToId === replyToId && own.start === start && own.end === end) {
      return { ok: true, quote: { replyToId, start, end } }
    }
  }
  if (!target || !validRange(target.content, start, end)) return BAD_QUOTE
  return { ok: true, quote: { replyToId, start, end } }
}

/**
 * The model's view of every quoted user message in `ids` (Q19), read from the
 * database, scoped to this chat: an id of another chat, or a target outside
 * it, is never read. A target that is gone is `deleted` (Q18). Messages
 * without a quote have no entry.
 *
 * `sending` is the message this request sends, whose quote was just checked
 * (`checkQuote`): a new turn's saved id may differ from the browser's, and an
 * edit's saved row still holds the old version. Its quote is taken from
 * `sending` instead of from its row; the quoted text still comes from the
 * database.
 */
export async function quotesForModel(
  workspaceId: string,
  sessionId: string,
  ids: string[],
  sending?: { id: string; quote: QuoteRef | null },
): Promise<Map<string, QuoteForModel>> {
  const out = new Map<string, QuoteForModel>()
  if (!isUuidV4(sessionId)) return out
  const db = await getDb()
  const [owned] = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(and(eq(sessions.id, sessionId), eq(sessions.workspaceId, workspaceId)))
  if (!owned) return out

  const refs = new Map<string, QuoteRef>()
  const saved = ids.filter((id) => id !== sending?.id && isUuidV4(id))
  if (saved.length > 0) {
    const rows = await db
      .select({ id: messages.id, replyToId: messages.replyToId, start: messages.quoteStart, end: messages.quoteEnd })
      .from(messages)
      .where(and(eq(messages.sessionId, sessionId), eq(messages.role, 'user'), inArray(messages.id, saved), isNotNull(messages.replyToId)))
    for (const r of rows) if (r.replyToId) refs.set(r.id, { replyToId: r.replyToId, start: r.start, end: r.end })
  }
  if (sending?.quote) refs.set(sending.id, sending.quote)
  if (refs.size === 0) return out

  const targetIds = [...new Set([...refs.values()].map((q) => q.replyToId))]
  const found = await db
    .select({ id: messages.id, role: messages.role, content: messages.content })
    .from(messages)
    .where(and(eq(messages.sessionId, sessionId), inArray(messages.id, targetIds)))
  const targets = new Map(found.map((t) => [t.id, t]))
  for (const [id, q] of refs) {
    const t = targets.get(q.replyToId)
    out.set(id, t
      ? { kind: q.start === null ? 'whole' : 'part', role: t.role as 'user' | 'assistant', text: quotedText(t.content, q.start, q.end) }
      : { kind: 'deleted' })
  }
  return out
}
