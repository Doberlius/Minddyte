import { and, eq, inArray, sql } from 'drizzle-orm'
import { getDb, chatPointers, forgotten, messageNodes, messages, nodes, sessionNodes, sessions } from '../../db'
import { mentionsPaddedSql, mentionsSql, notForgottenPaddedSql, paddedWordsSql } from '@/lib/mentions'
import { classifyParts } from '@/lib/label-parts'
import { recountNodes, rederiveHeadline, type Tx } from './links'

/** A runaway guard for a huge chat, not a design limit: the modal shows 3 and "and N more". */
export const PREVIEW_CAP = 500

/**
 * A word of a multi-word name that some sentences mention on their own.
 * F9–F12. Only a word with `alsoConcept` false and `partOf` empty can be
 * ticked (classifyParts, F14/F15).
 */
export type ForgetPart = {
  word: string
  total: number
  sentences: string[]
  /** F14: the word is itself another concept of this chat. */
  alsoConcept: boolean
  /** F15: the other concepts of this chat whose names contain the word, A to Z. */
  partOf: string[]
  /** Whether this chat's title mentions the word (F6, for a ticked word). */
  titleMentions: boolean
}

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

/** Every concept linked to this chat, for classifyParts. Workspace-filtered like linkedConcept. */
async function linkedConcepts(db: Db | Tx, workspaceId: string, sessionId: string) {
  return db
    .select({ key: nodes.canonicalKey, label: nodes.label })
    .from(sessionNodes)
    .innerJoin(nodes, eq(nodes.id, sessionNodes.nodeId))
    .where(and(eq(sessionNodes.sessionId, sessionId), eq(nodes.workspaceId, workspaceId)))
}

type Found = { total: number; sentences: string[] }

/**
 * Every passage of this chat that some forget would newly hide, found in
 * ONE pass: `names[0]` is the concept's whole name, the rest are its words.
 * For each, how many passages match and up to PREVIEW_CAP of their texts,
 * in the order they were said.
 *
 *   - The whole name's list: passages that mention it.
 *   - A word's list: passages that mention the word but NOT the whole name
 *     (those are in the whole name's list already). F9–F10.
 *   - Neither lists a passage an earlier forget in this chat already hides:
 *     the same read-time rule retrieval and the Archive count use.
 *
 * Final review, item 2: this used to be two scans per name (a count, then
 * the texts), each reducing every passage to words again. Ticket 15's giant
 * message with a four-word name took 6.5 s on the connection every visitor
 * shares. Now each passage is reduced to words once (`pw`, kept apart by
 * `offset 0`, as in src/lib/mentions.ts), every name is checked against
 * that, and window functions count and rank each list in the same pass:
 * 1.1 s, whatever the number of words. Only the rows some list keeps have
 * their text cut out of the message, once each; that cut (substring()
 * walking a long message to the offset) is most of what is left.
 */
async function previewPassages(db: Db, workspaceId: string, sessionId: string, names: string[]): Promise<Found[]> {
  const col = (prefix: string, i: number) => sql.raw(`${prefix}${i}`)
  // m<i>: the passage mentions names[i]. k<i>: it belongs in names[i]'s list.
  const mentions = names.map((name, i) => sql`${mentionsPaddedSql(sql`pw.padded`, sql`${name}::text`)} as ${col('m', i)}`)
  const inList = (i: number) => (i === 0 ? sql`m0` : sql`(${col('m', i)} and not m0)`)
  // t<i>: the list's full length. r<i>: this passage's place in it, in the order said.
  const counts = names.map(
    (_, i) => sql`count(*) filter (where ${inList(i)}) over () as ${col('t', i)},
      count(*) filter (where ${inList(i)}) over said as ${col('r', i)}`,
  )
  const kept = (i: number) => sql`(${inList(i)} and ${col('r', i)} <= ${PREVIEW_CAP})`

  const result = await db.execute(sql`
    select ${sql.join(names.map((_, i) => sql`${col('t', i)}::int as ${col('t', i)}, ${kept(i)} as ${col('s', i)}`), sql`, `)},
      substring(${messages.content} from x.start_char + 1 for x.end_char - x.start_char) as text
    from (
      select x.*, ${sql.join(counts, sql`, `)}
      from (
        select ${chatPointers.messageId} as message_id, ${messages.createdAt} as said_at, ${chatPointers.ordinal} as ordinal,
          ${chatPointers.startChar} as start_char, ${chatPointers.endChar} as end_char,
          ${sql.join(mentions, sql`, `)}
        from ${chatPointers}
        inner join ${messages} on ${messages.id} = ${chatPointers.messageId}
        cross join lateral (select ${paddedWordsSql(chatPointers.matchText)} as padded offset 0) pw
        where ${chatPointers.workspaceId} = ${workspaceId} and ${chatPointers.sessionId} = ${sessionId}
          and ${notForgottenPaddedSql(chatPointers.sessionId, sql`pw.padded`)}
      ) x
      where ${sql.join(names.map((_, i) => inList(i)), sql` or `)}
      window said as (order by said_at, message_id, ordinal rows between unbounded preceding and current row)
    ) x
    inner join ${messages} on ${messages.id} = x.message_id
    where ${sql.join(names.map((_, i) => kept(i)), sql` or `)}
    order by x.said_at, x.message_id, x.ordinal`)

  const rows = (result as unknown as { rows: Record<string, unknown>[] }).rows
  return names.map((_, i) => ({
    // Every row carries the totals; no row means no list has anything.
    total: rows.length > 0 ? Number(rows[0][`t${i}`]) : 0,
    sentences: rows.filter((row) => row[`s${i}`] === true).map((row) => row.text as string),
  }))
}

/** For each word, whether this chat's title mentions it, by the same rule as sentences (F5). */
async function titleMentions(db: Db, sessionId: string, words: string[]): Promise<boolean[]> {
  if (words.length === 0) return []
  const [row] = await db
    .select(Object.fromEntries(words.map((word, i) => [`w${i}`, sql<boolean>`${mentionsSql(sessions.title, sql`${word}::text`)}`])))
    .from(sessions)
    .where(eq(sessions.id, sessionId))
  return words.map((_, i) => row?.[`w${i}`] === true)
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

  const words = classifyParts(node.label, key, await linkedConcepts(db, workspaceId, sessionId))
  const [main, ...found] = await previewPassages(db, workspaceId, sessionId, [node.label, ...words.map((w) => w.word)])

  const inTitle = await titleMentions(db, sessionId, words.map((w) => w.word))

  // F9–F10: a word is shown only if some sentence mentions it without the whole name.
  const parts: ForgetPart[] = words
    .map(({ word, kind, partOf }, i) => ({
      word,
      ...found[i],
      alsoConcept: kind === 'own-concept',
      partOf,
      titleMentions: inTitle[i],
    }))
    .filter((part) => part.total > 0)

  return { label: node.label, total: main.total, sentences: main.sentences, otherChats: node.chatCount - 1, titleMentions: node.titleMentions, parts }
}

/**
 * A ticked part is a word the name offers, but it may no longer be ticked:
 * since the modal opened, it became its own concept of this chat (F14) or
 * a word of another concept's name (F15), in another tab, say. Forgetting
 * it now would silence that concept, so nothing is forgotten; the route
 * answers 409 and the modal reads the chat again.
 */
export class PartsChangedError extends Error {
  constructor() {
    super('parts_changed')
    this.name = 'PartsChangedError'
  }
}

/**
 * Forget `key` in one chat (ticket 10), and the ticked `parts` of its name
 * (F9–F12). One transaction: record the concept and each accepted part in
 * `forgotten`, unlink the concept, move the headline if it was the
 * headline, recount, delete it if no chat holds it.
 *
 * A part is accepted only if classifyParts calls it 'offer': a word the
 * name offers that is neither another concept of this chat (F14) nor a word
 * of another concept's name (F15). One forget never silences another
 * concept; that one is forgotten on its own. A word the name offers that
 * is refused throws PartsChangedError, and the transaction changes nothing
 * (final review, item 3). A word the name does not contain at all is
 * ignored: the name and the chat, not the request, are the authority. Messages and their pointers are untouched; retrieval hides the
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

    const classified = new Map(
      classifyParts(node.label, key, await linkedConcepts(tx, workspaceId, sessionId)).map((part) => [
        part.word.toLowerCase(),
        part,
      ]),
    )
    const asked = parts.map((p) => classified.get(p.toLowerCase())).filter((part) => part !== undefined)
    // Thrown inside the transaction, so it rolls back: nothing has been written yet anyway.
    if (asked.some((part) => part.kind !== 'offer')) throw new PartsChangedError()
    const words = [...new Set(asked.map((part) => part.word))]

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
