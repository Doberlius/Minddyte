import { getDb, sessions, nodes, sessionNodes } from "../../db"
import { and, eq, inArray, ne, or, sql } from "drizzle-orm"
import { rankCandidates, AUTO_REACH_CAP, type Candidate } from "@/lib/rank"
import { extractConcepts } from "@/lib/extract"
import { canonicalKey } from "@/lib/text"

/** Spec §6.2 — a QUALITY limit, not a capacity one. */
export const CONTEXT_CHAR_BUDGET = 2000 * 4 // ~2000 tokens

type Row = {
  chatId: string
  title: string
  compaction: string
  label: string
  chatCount: number
  isHeadline: boolean
  lastReferencedAt: Date
  createdAt: Date
}

/**
 * Spec §6.6 — ONE query. Not three sequential ones.
 * Match Nodes, find their Chats, and fetch those Chats' compactions together.
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
      compaction: sessions.compaction,
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

export async function retrieveContext(input: {
  workspaceId: string
  sessionId: string
  mode: "focus" | "explore"
  taggedChatIds: string[]
  draftText: string
  /**
   * How many characters of memory this request may carry.
   *
   * Passed in rather than read from the constant because the per-request cap
   * is shared with the message itself: a long message leaves less room, and
   * the caller is the only one that knows how long it was. Defaults to the
   * quality budget for every caller that has no cap of its own.
   */
  budgetChars?: number
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
  const meta = new Map<string, { title: string; compaction: string }>()
  for (const r of rows) {
    meta.set(r.chatId, { title: r.title, compaction: r.compaction })
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

  // Tagged chats are UNCAPPED; only automatic reaches are capped. Spec §6.2.
  const autoRanked = rankCandidates([...byChat.values()].filter((c) => c.kind === "overlap"))
    .slice(0, AUTO_REACH_CAP)

  const taggedRows = input.taggedChatIds.length
    ? await db
        .select({
          id: sessions.id,
          title: sessions.title,
          compaction: sessions.compaction,
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
            // its compaction. Tagging is uncapped and skips ranking, so it is
            // the widest door in the retrieval path.
            eq(sessions.workspaceId, input.workspaceId),
          ),
        )
    : []

  // Tagged chats go through the same ranking chain as auto reaches, uncapped.
  // A tagged chat that also shares nodes reuses the sharedNodes already
  // gathered for it in byChat; otherwise it has none. Spec §6.5.
  for (const t of taggedRows) meta.set(t.id, { title: t.title, compaction: t.compaction })
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
      compaction: meta.get(c.chatId)!.compaction,
      why: c.sharedNodes.length
        ? `tagged · shares ${c.sharedNodes.map((n) => n.label).join(", ")}`
        : "tagged",
    })),
    ...autoRanked.map((c) => ({
      id: c.chatId,
      title: meta.get(c.chatId)!.title,
      compaction: meta.get(c.chatId)!.compaction,
      why: `shares ${c.sharedNodes.map((n) => n.label).join(", ")}`,
    })),
  ]

  // Over budget: send what fits, report what did not. Spec §6.5.
  // Degrade by dropping WHOLE chats — never truncate a compaction.
  const chats: typeof ordered = []
  const dropped: string[] = []
  let used = 0
  const budget = input.budgetChars ?? CONTEXT_CHAR_BUDGET
  for (const c of ordered) {
    if (used + c.compaction.length > budget) { dropped.push(c.title); continue }
    chats.push(c)
    used += c.compaction.length
  }
  return { chats, dropped }
}
