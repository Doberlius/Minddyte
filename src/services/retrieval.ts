import { db, sessions, nodes, sessionNodes } from "../../db"
import { and, eq, ne, sql } from "drizzle-orm"
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
async function candidateRows(userId: string, sessionId: string, keys: string[]): Promise<Row[]> {
  if (keys.length === 0) return []
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
        eq(nodes.userId, userId),
        ne(sessions.id, sessionId),
        sql`${nodes.archivedAt} is null`,
        sql`${nodes.canonicalKey} = any(${keys})`,
      ),
    )
}

export async function retrieveContext(input: {
  userId: string
  sessionId: string
  mode: "focus" | "explore"
  taggedChatIds: string[]
  draftText: string
}) {
  const tagged = new Set(input.taggedChatIds)

  // In focus, automatic reach is ignored entirely. Spec §6.1.
  const keys =
    input.mode === "explore"
      ? extractConcepts(input.draftText).auto.map(canonicalKey).filter(Boolean)
      : []

  const rows = await candidateRows(input.userId, input.sessionId, keys)

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
    if (existing) existing.sharedNodes.push(shared)
    else
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

  const taggedRows = await db
    .select({
      id: sessions.id,
      title: sessions.title,
      compaction: sessions.compaction,
      createdAt: sessions.createdAt,
      updatedAt: sessions.updatedAt,
    })
    .from(sessions)
    .where(and(eq(sessions.userId, input.userId), sql`${sessions.id} = any(${input.taggedChatIds})`))

  const ordered = [
    ...taggedRows.map((t) => ({ id: t.id, title: t.title, compaction: t.compaction, why: "tagged" })),
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
  for (const c of ordered) {
    if (used + c.compaction.length > CONTEXT_CHAR_BUDGET) { dropped.push(c.title); continue }
    chats.push(c)
    used += c.compaction.length
  }
  return { chats, dropped }
}
