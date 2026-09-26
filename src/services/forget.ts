import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { getDb, chatPointers, forgotten, messageNodes, messages, nodes, sessionNodes, sessions } from '../../db'
import { mentionsSql, notForgottenSql } from '@/lib/mentions'
import { recountNodes, rederiveHeadline } from './links'

/** A runaway guard for a huge chat, not a design limit: the modal shows 3 and "and N more". */
export const PREVIEW_CAP = 500

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
  const match = and(
    eq(chatPointers.workspaceId, workspaceId),
    eq(chatPointers.sessionId, sessionId),
    mentionsSql(chatPointers.matchText, sql`${node.label}::text`),
    notForgottenSql(chatPointers.sessionId, chatPointers.matchText),
  )
  const [{ n }] = await db.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(chatPointers).where(match)
  const rows = await db
    .select({
      text: sql<string>`substring(${messages.content} from ${chatPointers.startChar} + 1 for ${chatPointers.endChar} - ${chatPointers.startChar})`,
    })
    .from(chatPointers)
    .innerJoin(messages, eq(messages.id, chatPointers.messageId))
    .where(match)
    .orderBy(asc(messages.createdAt), asc(chatPointers.messageId), asc(chatPointers.ordinal))
    .limit(PREVIEW_CAP)

  return {
    label: node.label,
    total: n,
    sentences: rows.map((r) => r.text),
    otherChats: node.chatCount - 1,
    titleMentions: node.titleMentions,
  }
}

/**
 * Forget `key` in one chat (ticket 10). One transaction: record it, unlink it,
 * move the headline if it was the headline, recount, delete it if no chat
 * holds it. Messages and their pointers are untouched; retrieval hides the
 * pointers at read time. Returns false when the chat does not hold it, which
 * includes a second forget of the same concept.
 */
export async function forgetConcept(workspaceId: string, sessionId: string, key: string): Promise<boolean> {
  const db = await getDb()
  return db.transaction(async (tx) => {
    const [node] = await tx
      .select({ id: nodes.id, label: nodes.label, headline: sessions.headlineNodeId })
      .from(sessionNodes)
      .innerJoin(nodes, eq(nodes.id, sessionNodes.nodeId))
      .innerJoin(sessions, eq(sessions.id, sessionNodes.sessionId))
      .where(linkedConcept(sessionId, workspaceId, key))
    if (!node) return false

    await tx.insert(forgotten).values({ sessionId, nodeLabel: node.label }).onConflictDoNothing()
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
