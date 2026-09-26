import { and, asc, eq, inArray, sql, type SQL } from 'drizzle-orm'
import { getDb, chatPointers, forgotten, messageNodes, messages, nodes, sessionNodes, sessions } from '../../db'
import { mentionsSql, notForgottenSql } from '@/lib/mentions'
import { labelParts } from '@/lib/label-parts'
import { canonicalKey } from '@/lib/text'
import { recountNodes, rederiveHeadline } from './links'

/** A runaway guard for a huge chat, not a design limit: the modal shows 3 and "and N more". */
export const PREVIEW_CAP = 500

/** A word of a multi-word name that some sentences mention on their own. F9–F12. */
export type ForgetPart = { word: string; total: number; sentences: string[]; alsoConcept: boolean }

export type ForgetPreview = {
  label: string
  /** Every passage of this chat that mentions it, both roles, and that no earlier forget already hides. */
  total: number
  /** Up to PREVIEW_CAP of them, in the order they were said. */
  sentences: string[]
  /** How many OTHER chats keep this concept after it is forgotten here. */
  otherChats: number
  /** Whether this chat's title mentions it (ticket 10, F6). */
  titleMentions: boolean
  /** Words of a multi-word name that some sentences mention on their own. F9–F12. */
  parts: ForgetPart[]
}

/**
 * The concept `key` as linked to THIS chat of THIS workspace, or nothing.
 * Both workspace filters, so a foreign chat id is indistinguishable from a
 * missing one.
 */
function linkedConcept(sessionId: string, workspaceId: string, key: string) {
  return and(
    eq(sessionNodes.sessionId, sessionId),
    eq(sessions.workspaceId, workspaceId),
    eq(nodes.workspaceId, workspaceId),
    eq(nodes.canonicalKey, key),
  )
}

type Db = Awaited<ReturnType<typeof getDb>>

/** How many passages match, and up to PREVIEW_CAP of their texts in the order they were said. */
async function passages(db: Db, where: SQL | undefined): Promise<{ total: number; sentences: string[] }> {
  const [{ n }] = await db.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(chatPointers).where(where)
  const rows = await db
    .select({
      text: sql<string>`substring(${messages.content} from ${chatPointers.startChar} + 1 for ${chatPointers.endChar} - ${chatPointers.startChar})`,
    })
    .from(chatPointers)
    .innerJoin(messages, eq(messages.id, chatPointers.messageId))
    .where(where)
    .orderBy(asc(messages.createdAt), asc(chatPointers.messageId), asc(chatPointers.ordinal))
    .limit(PREVIEW_CAP)
  return { total: n, sentences: rows.map((r) => r.text) }
}

/** What forgetting `key` in this chat would hide. Null when the chat does not hold it. */
export async function forgetPreview(workspaceId: string, sessionId: string, key: string): Promise<ForgetPreview | null> {
  const db = await getDb()
  const [node] = await db
    .select({
      label: nodes.label,
      chatCount: nodes.chatCount,
      titleMentions: sql<boolean>`${mentionsSql(sessions.title, nodes.label)}`,
    })
    .from(sessionNodes)
    .innerJoin(nodes, eq(nodes.id, sessionNodes.nodeId))
    .innerJoin(sessions, eq(sessions.id, sessionNodes.sessionId))
    .where(linkedConcept(sessionId, workspaceId, key))
  if (!node) return null

  // Only what THIS forget newly hides: a sentence that also mentions a
  // concept forgotten earlier in this chat is hidden already, by the same
  // read-time rule retrieval and the Archive count use.
  const inChat = and(
    eq(chatPointers.workspaceId, workspaceId),
    eq(chatPointers.sessionId, sessionId),
    notForgottenSql(chatPointers.sessionId, chatPointers.matchText),
  )
  const label = sql`${node.label}::text`
  const main = await passages(db, and(inChat, mentionsSql(chatPointers.matchText, label)))

  // F9–F10: each word of the name that some sentence mentions WITHOUT the
  // whole name. Those with the whole name are in the main list already.
  const linkedKeys = new Set(
    (
      await db
        .select({ key: nodes.canonicalKey })
        .from(sessionNodes)
        .innerJoin(nodes, eq(nodes.id, sessionNodes.nodeId))
        .where(and(eq(sessionNodes.sessionId, sessionId), eq(nodes.workspaceId, workspaceId)))
    ).map((r) => r.key),
  )
  const parts: ForgetPart[] = []
  for (const word of labelParts(node.label)) {
    const found = await passages(
      db,
      and(inChat, mentionsSql(chatPointers.matchText, sql`${word}::text`), sql`not ${mentionsSql(chatPointers.matchText, label)}`),
    )
    if (found.total > 0) parts.push({ word, ...found, alsoConcept: linkedKeys.has(canonicalKey(word)) })
  }

  return { label: node.label, total: main.total, sentences: main.sentences, otherChats: node.chatCount - 1, titleMentions: node.titleMentions, parts }
}

/**
 * Forget `key` in one chat (ticket 10), and the ticked `parts` of its name
 * (F9–F12). One transaction: record the concept and each accepted part in
 * `forgotten`, unlink the concept, move the headline if it was the
 * headline, recount, delete it if no chat holds it.
 *
 * A part is accepted only if it is a word the name offers (labelParts) AND
 * not itself a concept linked to this chat (F14: one forget never removes
 * another concept; that one is forgotten on its own). Anything else in the
 * request is ignored: the name and the chat, not the request, are the
 * authority. Messages and their pointers are untouched; retrieval hides the
 * pointers at read time. Returns false when the chat does not hold `key`,
 * which includes a second forget of the same concept.
 */
export async function forgetConcept(workspaceId: string, sessionId: string, key: string, parts: string[] = []): Promise<boolean> {
  const db = await getDb()
  return db.transaction(async (tx) => {
    const [node] = await tx
      .select({ id: nodes.id, label: nodes.label, headline: sessions.headlineNodeId })
      .from(sessionNodes)
      .innerJoin(nodes, eq(nodes.id, sessionNodes.nodeId))
      .innerJoin(sessions, eq(sessions.id, sessionNodes.sessionId))
      .where(linkedConcept(sessionId, workspaceId, key))
    if (!node) return false

    const linkedKeys = new Set(
      (
        await tx
          .select({ key: nodes.canonicalKey })
          .from(sessionNodes)
          .innerJoin(nodes, eq(nodes.id, sessionNodes.nodeId))
          .where(and(eq(sessionNodes.sessionId, sessionId), eq(nodes.workspaceId, workspaceId)))
      ).map((r) => r.key),
    )
    const offered = new Map(
      labelParts(node.label)
        .filter((w) => !linkedKeys.has(canonicalKey(w)))
        .map((w) => [w.toLowerCase(), w]),
    )
    const words = [...new Set(parts.map((p) => offered.get(p.toLowerCase())).filter((w): w is string => Boolean(w)))]

    await tx
      .insert(forgotten)
      .values([node.label, ...words].map((nodeLabel) => ({ sessionId, nodeLabel })))
      .onConflictDoNothing()
    await tx.delete(sessionNodes).where(and(eq(sessionNodes.sessionId, sessionId), eq(sessionNodes.nodeId, node.id)))
    await tx
      .delete(messageNodes)
      .where(
        and(
          eq(messageNodes.nodeId, node.id),
          inArray(messageNodes.messageId, tx.select({ id: messages.id }).from(messages).where(eq(messages.sessionId, sessionId))),
        ),
      )
    if (node.headline === node.id) await rederiveHeadline(tx, workspaceId, sessionId)
    await recountNodes(tx, workspaceId, [node.id])
    return true
  })
}
