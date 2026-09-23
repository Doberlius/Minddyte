import { getDb, sessions, nodes, sessionNodes, chatPointers, messages } from "../../db"
import { and, eq, inArray, ne, or, sql } from "drizzle-orm"
import { rankCandidates, AUTO_REACH_CAP, type Candidate } from "@/lib/rank"
import { extractConcepts } from "@/lib/extract"
import { canonicalKey } from "@/lib/text"
import { selectWindows, type ScoredPointer } from "@/lib/windows"
import { PROVISIONAL } from "@/lib/provisional"
import { strongPhrases } from "@/lib/tokens"

/** Spec §6.2 — a QUALITY limit, not a capacity one. */
export const CONTEXT_CHAR_BUDGET = 2000 * 4 // ~2000 tokens

type Row = {
  chatId: string
  title: string
  label: string
  chatCount: number
  isHeadline: boolean
  lastReferencedAt: Date
  createdAt: Date
}

/**
 * Spec §6.6 — ONE query. Not three sequential ones.
 * Match Nodes, find their Chats, and fetch those Chats' metadata together.
 * Written as three tidy functions this triples the only cost that matters.
 */
async function candidateRows(
  workspaceId: string,
  sessionId: string,
  draftKeys: string[],
): Promise<Row[]> {
  const db = await getDb()

  // Spec §6.1 — explore reaches Chats "sharing a Node with the current Chat",
  // so the current Chat's own Nodes are the primary match set. Kept as a
  // SUBQUERY rather than a prior round trip: §6.6's rule is that matching and
  // fetching happen in one query, and a separate lookup would make it two.
  const currentChatKeys = db
    .select({ k: nodes.canonicalKey })
    .from(sessionNodes)
    .innerJoin(nodes, eq(nodes.id, sessionNodes.nodeId))
    .where(and(eq(sessionNodes.sessionId, sessionId), eq(nodes.workspaceId, workspaceId)))

  // The draft's concepts are NOT yet Nodes — graph writes happen after the
  // response streams (§4.5) — so they are unioned in separately. They carry
  // the user's current intent, which the Chat's accumulated Nodes do not.
  const matches =
    draftKeys.length > 0
      ? or(inArray(nodes.canonicalKey, currentChatKeys), inArray(nodes.canonicalKey, draftKeys))
      : inArray(nodes.canonicalKey, currentChatKeys)

  return db
    .select({
      chatId: sessions.id,
      title: sessions.title,
      label: nodes.label,
      chatCount: nodes.chatCount,
      isHeadline: sql<boolean>`${sessions.headlineNodeId} = ${nodes.id}`.mapWith(Boolean),
      lastReferencedAt: nodes.lastReferencedAt,
      createdAt: sessions.createdAt,
    })
    .from(nodes)
    .innerJoin(sessionNodes, eq(sessionNodes.nodeId, nodes.id))
    .innerJoin(sessions, eq(sessions.id, sessionNodes.sessionId))
    .where(
      and(
        ne(sessions.id, sessionId),
        sql`${nodes.archivedAt} is null`,
        // The query starts from `nodes` and joins to `sessions` through
        // `session_nodes`. `ingestUserMessage` now proves ownership of
        // `sessionId` before it ever writes a `session_nodes` link (see
        // graph.ts), so that link table only ever pairs a session and a node
        // from the SAME workspace — under that invariant, either filter
        // alone already keeps a stranger's row out, and removing just one of
        // the two leaves the suite green. Both stay anyway, at the root of
        // each query rather than on a joined table (Spec §1): defense in
        // depth against that invariant ever breaking upstream, since this
        // query has no way to tell "it held" from "it didn't, but the other
        // filter caught it".
        eq(sessions.workspaceId, workspaceId),
        eq(nodes.workspaceId, workspaceId),
        // sql`= any(${keys})` with a JS array compiles to a row constructor
        // `= any(($1, $2))`, which Postgres rejects — inArray compiles to
        // `in ($1, $2)` instead. Do not "optimise" this back to sql`= any(...)`.
        matches,
      ),
    )
}

/**
 * The passages of the chosen chats, scored against the question, text read
 * back from `messages` by offset (offsets are code points, as substring()
 * counts). Scored against the draft AND each shared concept label, so a chat
 * reached through a Node alone still has something to rank its passages by.
 */
async function scoredPointers(
  workspaceId: string,
  chatIds: string[],
  queries: string[],
): Promise<Map<string, ScoredPointer[]>> {
  const out = new Map<string, ScoredPointer[]>()
  if (chatIds.length === 0) return out
  const db = await getDb()
  const scores = queries.filter((q) => q.trim()).map((q) => sql`word_similarity(${q}, ${chatPointers.matchText})`)
  const score = scores.length > 0 ? sql`greatest(${sql.join(scores, sql`, `)})` : sql`0`

  const rows = await db
    .select({
      chatId: chatPointers.sessionId,
      messageId: chatPointers.messageId,
      ordinal: chatPointers.ordinal,
      messageCreatedAt: messages.createdAt,
      text: sql<string>`substring(${messages.content} from ${chatPointers.startChar} + 1 for ${chatPointers.endChar} - ${chatPointers.startChar})`,
      score: sql<number>`${score}`.mapWith(Number),
    })
    .from(chatPointers)
    .innerJoin(messages, eq(messages.id, chatPointers.messageId))
    .where(and(eq(chatPointers.workspaceId, workspaceId), inArray(chatPointers.sessionId, chatIds)))

  for (const r of rows) {
    const list = out.get(r.chatId) ?? []
    list.push({ messageId: r.messageId, messageCreatedAt: r.messageCreatedAt.getTime(), ordinal: r.ordinal, text: r.text, score: r.score })
    out.set(r.chatId, list)
  }
  return out
}

type TextHit = {
  chatId: string
  title: string
  reach: number
  strong: number
  phrase: string | null
  createdAt: Date
  updatedAt: Date
}

/**
 * Chats whose passages match the draft's words. Ticket 05, rounds 2–4:
 *   reach      word_similarity(draft, passage) >= PROVISIONAL.reachWordSimilarity
 *   promotion  strict_word_similarity(phrase, passage) >= PROVISIONAL.strongStrictSimilarity
 *              for a draft phrase of >= 2 significant tokens (strongPhrases)
 *
 * The operators `<%` and `<<%` use the GIN index, and read their thresholds
 * from GUCs. Those are set with SET LOCAL inside this transaction: a bare SET
 * would outlive it, and on single-connection PGlite that means for the life of
 * the process.
 */
async function textHits(workspaceId: string, sessionId: string, draft: string): Promise<TextHit[]> {
  if (!draft.trim()) return []
  const db = await getDb()
  const phrases = strongPhrases(draft)

  return db.transaction(async (tx) => {
    await tx.execute(sql.raw(`set local pg_trgm.word_similarity_threshold = ${PROVISIONAL.reachWordSimilarity}`))
    await tx.execute(sql.raw(`set local pg_trgm.strict_word_similarity_threshold = ${PROVISIONAL.strongStrictSimilarity}`))

    const phraseMatch = phrases.length
      ? sql.join(phrases.map((p) => sql`${p} <<% ${chatPointers.matchText}`), sql` or `)
      : sql`false`
    // Per-phrase strict_word_similarity maxima, as separate named columns:
    // dynamic column keys (`...perPhrase` spread into `.select({...})`) do not
    // typecheck against drizzle's select-shape inference, which needs a
    // statically known object literal. A parallel array of `{ p, s }`
    // aggregate expressions, unpacked into named columns below, keeps the
    // same one-query, one-transaction shape the brief calls for.
    const perPhrase = phrases.map(
      (p, i) => [`s${i}`, sql<number>`max(strict_word_similarity(${p}, ${chatPointers.matchText}))`.mapWith(Number)] as const,
    )

    const rows = await tx
      .select({
        chatId: sessions.id,
        title: sessions.title,
        createdAt: sessions.createdAt,
        updatedAt: sessions.updatedAt,
        reach: sql<number>`max(word_similarity(${draft}, ${chatPointers.matchText}))`.mapWith(Number),
        ...Object.fromEntries(perPhrase),
      })
      .from(chatPointers)
      .innerJoin(sessions, eq(sessions.id, chatPointers.sessionId))
      .where(
        and(
          // Both, at the root, as candidateRows does: defense in depth.
          eq(chatPointers.workspaceId, workspaceId),
          eq(sessions.workspaceId, workspaceId),
          ne(chatPointers.sessionId, sessionId),
          sql`(${draft} <% ${chatPointers.matchText} or ${phraseMatch})`,
        ),
      )
      .groupBy(sessions.id, sessions.title, sessions.createdAt, sessions.updatedAt)

    return rows.map((r) => {
      const scores = phrases.map((_, i) => (r as unknown as Record<string, number>)[`s${i}`] ?? 0)
      const best = scores.reduce((bi, s, i) => (s > scores[bi] ? i : bi), 0)
      return {
        chatId: r.chatId, title: r.title, createdAt: r.createdAt, updatedAt: r.updatedAt, reach: r.reach,
        strong: scores.length ? scores[best] : 0,
        phrase: scores.length ? phrases[best] : null,
      }
    })
  })
}

export async function retrieveContext(input: {
  workspaceId: string
  sessionId: string
  mode: "focus" | "explore"
  taggedChatIds: string[]
  draftText: string
}) {
  const db = await getDb()
  const tagged = new Set(input.taggedChatIds)

  // In focus, automatic reach is ignored entirely — only what the user
  // tagged. Spec §6.1. The skip is the CALL, not an empty key list: the
  // match set now includes the current Chat's own Nodes, so passing no draft
  // keys would still reach in explore, which is exactly what focus forbids.
  const rows =
    input.mode === "explore"
      ? await candidateRows(
          input.workspaceId,
          input.sessionId,
          extractConcepts(input.draftText).auto.map(canonicalKey).filter(Boolean),
        )
      : []

  const byChat = new Map<string, Candidate>()
  const meta = new Map<string, { title: string }>()
  for (const r of rows) {
    meta.set(r.chatId, { title: r.title })
    const existing = byChat.get(r.chatId)
    const shared = {
      label: r.label,
      chatCount: r.chatCount,
      isHeadlineOfCandidate: r.isHeadline,
    }
    if (existing) {
      existing.sharedNodes.push(shared)
      // Order-independent: the query has no ORDER BY, so taking the first row's
      // timestamp would make ranking step 4 depend on Postgres's row order.
      existing.lastReferencedAt = Math.max(existing.lastReferencedAt, r.lastReferencedAt.getTime())
    } else
      byChat.set(r.chatId, {
        chatId: r.chatId,
        kind: tagged.has(r.chatId) ? "bridge" : "overlap",
        sharedNodes: [shared],
        lastReferencedAt: r.lastReferencedAt.getTime(),
        createdAt: r.createdAt.getTime(),
      })
  }

  // Text reach — explore only, like Node reach (§6.1).
  const textWhy = new Map<string, string>()
  const hits = input.mode === "explore" ? await textHits(input.workspaceId, input.sessionId, input.draftText) : []
  for (const h of hits) {
    if (tagged.has(h.chatId)) continue // tagged chats are handled below, uncapped
    const strong = h.strong >= PROVISIONAL.strongStrictSimilarity
    meta.set(h.chatId, { title: h.title })
    textWhy.set(
      h.chatId,
      strong ? `matches exact phrase "${h.phrase}" (${h.strong.toFixed(2)})` : `matches your wording (${h.reach.toFixed(2)})`,
    )
    const existing = byChat.get(h.chatId)
    if (existing) {
      // Already reached through a Node: strong text evidence outranks overlap;
      // an ordinary match does not demote it.
      if (strong) { existing.kind = "strong-text"; existing.textScore = h.strong }
    } else {
      byChat.set(h.chatId, {
        chatId: h.chatId,
        kind: strong ? "strong-text" : "text",
        sharedNodes: [],
        textScore: strong ? h.strong : h.reach,
        lastReferencedAt: h.updatedAt.getTime(),
        createdAt: h.createdAt.getTime(),
      })
    }
  }

  // Tagged chats are UNCAPPED; only automatic reaches are capped. Spec §6.2.
  const autoRanked = rankCandidates([...byChat.values()].filter((c) => c.kind !== "bridge"))
    .slice(0, AUTO_REACH_CAP)

  const taggedRows = input.taggedChatIds.length
    ? await db
        .select({
          id: sessions.id,
          title: sessions.title,
          createdAt: sessions.createdAt,
          updatedAt: sessions.updatedAt,
        })
        .from(sessions)
        .where(
          and(
            ne(sessions.id, input.sessionId),
            inArray(sessions.id, input.taggedChatIds),
            // taggedChatIds arrives from the client — this is the filter that
            // stops a visitor naming someone else's chat id and being handed
            // its passages. Tagging is uncapped and skips ranking, so it is
            // the widest door in the retrieval path.
            eq(sessions.workspaceId, input.workspaceId),
          ),
        )
    : []

  // Tagged chats go through the same ranking chain as auto reaches, uncapped.
  // A tagged chat that also shares nodes reuses the sharedNodes already
  // gathered for it in byChat; otherwise it has none. Spec §6.5.
  for (const t of taggedRows) meta.set(t.id, { title: t.title })
  const taggedCandidates: Candidate[] = taggedRows.map((t) => ({
    chatId: t.id,
    kind: "bridge",
    sharedNodes: byChat.get(t.id)?.sharedNodes ?? [],
    lastReferencedAt: t.updatedAt.getTime(),
    createdAt: t.createdAt.getTime(),
  }))
  const taggedRanked = rankCandidates(taggedCandidates)

  const ordered = [
    ...taggedRanked.map((c) => ({
      id: c.chatId,
      title: meta.get(c.chatId)!.title,
      labels: c.sharedNodes.map((n) => n.label),
      why: c.sharedNodes.length ? `tagged · shares ${c.sharedNodes.map((n) => n.label).join(", ")}` : "tagged",
    })),
    ...autoRanked.map((c) => ({
      id: c.chatId,
      title: meta.get(c.chatId)!.title,
      labels: c.sharedNodes.map((n) => n.label),
      why: [
        c.sharedNodes.length ? `shares ${c.sharedNodes.map((n) => n.label).join(", ")}` : null,
        textWhy.get(c.chatId) ?? null,
      ].filter(Boolean).join(" · "),
    })),
  ]

  // Second query: §6.6's "one query" bends here, deliberately. Ranking runs in
  // TypeScript between reach and fetch, so the chats to fetch passages for are
  // not known until reach has returned. Measured cost in ticket 05: ~3 ms.
  const labels = [...new Set(ordered.flatMap((c) => c.labels))]
  const pointers = await scoredPointers(input.workspaceId, ordered.map((c) => c.id), [input.draftText, ...labels])

  // Over budget: send what fits, report what did not. Spec §6.5. A passage is
  // included whole or skipped whole — never cut. A chat that loses ANY window
  // is reported, not only one that loses all of them: otherwise a chat can be
  // shrunk with nobody told.
  const chats: { id: string; title: string; excerpts: string[]; why: string }[] = []
  const dropped: string[] = []
  let used = 0
  for (const c of ordered) {
    const all = selectWindows(pointers.get(c.id) ?? [])
    if (all.length === 0) continue // nothing said there yet — not a budget loss
    const kept: string[] = []
    for (const e of all) {
      if (used + e.length > CONTEXT_CHAR_BUDGET) continue
      kept.push(e)
      used += e.length
    }
    if (kept.length < all.length) dropped.push(c.title)
    if (kept.length > 0) chats.push({ id: c.id, title: c.title, excerpts: kept, why: c.why })
  }
  return { chats, dropped }
}
