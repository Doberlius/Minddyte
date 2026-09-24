import { sql } from "drizzle-orm"
import {
  boolean, check, index, integer, pgTable, primaryKey,
  text, timestamp, unique, uniqueIndex, uuid, customType,
} from "drizzle-orm/pg-core"

const float4 = customType<{ data: number; driverData: number }>({
  dataType() { return "float4" },
})

export const collections = pgTable("collections", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull(),
  title: text("title").notNull(),
  category: text("category").notNull().default("General"),
  description: text("description"),
  tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
  featured: boolean("featured").notNull().default(false),
  lastActiveAt: timestamp("last_active_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  // Exactly one featured Collection PER WORKSPACE. Before this it was one
  // per database, so the second visitor to feature anything would collide
  // with the first — a unique-violation on someone else's row.
  uniqueIndex("idx_collections_one_featured")
    .on(t.workspaceId, t.featured)
    .where(sql`${t.featured} = true`),
])

export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull(),
  title: text("title").notNull().default("New Session"),
  preview: text("preview"),
  collectionId: uuid("collection_id").references(() => collections.id, { onDelete: "set null" }),
  // Spec §4.4 — set once at creation, never re-derived on rename.
  headlineNodeId: uuid("headline_node_id"),
  // Spec §9 — null means inherit the global default.
  modelId: text("model_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("idx_sessions_updated").on(t.updatedAt.desc()),
])

export const messages = pgTable("messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  sessionId: uuid("session_id").notNull().references(() => sessions.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  content: text("content").notNull(),
  modelUsed: text("model_used"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check("messages_role_check", sql`${t.role} in ('user', 'assistant')`),
  index("idx_messages_created").on(t.sessionId, t.createdAt.asc()),
])

export const nodes = pgTable("nodes", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull(),
  label: text("label").notNull(),
  // Spec §4.3 — the unique constraint IS the dedup mechanism.
  canonicalKey: text("canonical_key").notNull(),
  type: text("type").notNull().default("General"),
  summary: text("summary"),
  // Spec §3.1 — denormalized because §6.3 rarity needs it on the hot read path.
  chatCount: integer("chat_count").notNull().default(0),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  lastReferencedAt: timestamp("last_referenced_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  // The dedup mechanism, now scoped. Spec §2: without the workspace in this
  // constraint, two visitors who both say "PostgreSQL" infer onto the SAME
  // node row, session_nodes links both their chats to it, chat_count counts
  // across strangers, and the Brain canvas draws an edge between two people
  // who have never met. The chat list would look correctly separated the
  // whole time.
  unique("nodes_workspace_canonical_unique").on(t.workspaceId, t.canonicalKey),
])

// `edges` was dropped here rather than scoped. Layered-memory ticket 01
// found it unfillable — nothing ever wrote a node-to-node edge — and
// scoping a dead table would tell the next reader that Minddyte has a
// concept-to-concept graph. It does not: the graph is bipartite, chats to
// concepts and back.

export const graphPositions = pgTable("graph_positions", {
  nodeId: uuid("node_id").primaryKey().references(() => nodes.id, { onDelete: "cascade" }),
  x: float4("x").notNull().default(0),
  y: float4("y").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
})

/** Spec §7.2 — a Cluster is placed once and never recomputed. */
export const clusterOrigins = pgTable("cluster_origins", {
  workspaceId: uuid("workspace_id").notNull(),
  clusterKey: text("cluster_key").notNull(),
  x: float4("x").notNull(),
  y: float4("y").notNull(),
}, (t) => [primaryKey({ columns: [t.workspaceId, t.clusterKey] })])

/** Spec §3.2 — scoped to ONE Chat. Not the same as rejectedPhrases. */
export const forgotten = pgTable("forgotten", {
  sessionId: uuid("session_id").notNull().references(() => sessions.id, { onDelete: "cascade" }),
  nodeLabel: text("node_label").notNull(),
}, (t) => [primaryKey({ columns: [t.sessionId, t.nodeLabel] })])

/** Spec §3.2 — scoped to the ACCOUNT. Not the same as forgotten. */
export const rejectedPhrases = pgTable("rejected_phrases", {
  workspaceId: uuid("workspace_id").notNull(),
  phrase: text("phrase").notNull(),
}, (t) => [primaryKey({ columns: [t.workspaceId, t.phrase] })])

export const sessionNodes = pgTable("session_nodes", {
  sessionId: uuid("session_id").notNull().references(() => sessions.id, { onDelete: "cascade" }),
  nodeId: uuid("node_id").notNull().references(() => nodes.id, { onDelete: "cascade" }),
  addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.sessionId, t.nodeId] }),
  index("idx_session_nodes_node").on(t.nodeId),
])

export const messageNodes = pgTable("message_nodes", {
  messageId: uuid("message_id").notNull().references(() => messages.id, { onDelete: "cascade" }),
  nodeId: uuid("node_id").notNull().references(() => nodes.id, { onDelete: "cascade" }),
}, (t) => [
  primaryKey({ columns: [t.messageId, t.nodeId] }),
  index("idx_message_nodes_node").on(t.nodeId),
])

export const collectionNodes = pgTable("collection_nodes", {
  collectionId: uuid("collection_id").notNull().references(() => collections.id, { onDelete: "cascade" }),
  nodeId: uuid("node_id").notNull().references(() => nodes.id, { onDelete: "cascade" }),
}, (t) => [primaryKey({ columns: [t.collectionId, t.nodeId] })])

/**
 * Where each passage of a chat is — ticket 05 (read-time pointers).
 *
 * One row per sentence, code block or table, for both roles. The TEXT sent
 * to the model is read from `messages.content` by offset at question time, so
 * a quotation can never drift from what was said. `match_text` is a search
 * index only: if it ever drifted, the failure would be a missed match, never
 * a wrong quote.
 *
 * `workspace_id` is carried directly (Q9). Unlike `messages`, text search
 * STARTS here, scanning every chat's passages, so staying inside one
 * workspace must not depend on someone remembering a join.
 *
 * Offsets are code points, because Postgres substring() counts characters.
 */
export const chatPointers = pgTable("chat_pointers", {
  workspaceId: uuid("workspace_id").notNull(),
  sessionId: uuid("session_id").notNull().references(() => sessions.id, { onDelete: "cascade" }),
  messageId: uuid("message_id").notNull().references(() => messages.id, { onDelete: "cascade" }),
  ordinal: integer("ordinal").notNull(),
  kind: text("kind").notNull(),
  startChar: integer("start_char").notNull(),
  endChar: integer("end_char").notNull(),
  matchText: text("match_text").notNull(),
}, (t) => [
  primaryKey({ columns: [t.messageId, t.ordinal] }),
  check("chat_pointers_kind_check", sql`${t.kind} in ('sentence', 'code', 'table')`),
  check("chat_pointers_span_check", sql`${t.startChar} >= 0 and ${t.endChar} > ${t.startChar}`),
  index("idx_chat_pointers_session").on(t.sessionId),
  index("idx_chat_pointers_match_trgm").using("gin", t.matchText.op("gin_trgm_ops")),
])

/**
 * Code migrations that have run — the backfill that cannot be a .sql file,
 * because computing pointers needs remark. Drizzle's own table records .sql
 * migrations only. One row per step, so a step never runs twice.
 */
export const dataMigrations = pgTable("data_migrations", {
  name: text("name").primaryKey(),
  appliedAt: timestamp("applied_at", { withTimezone: true }).notNull().defaultNow(),
})

/**
 * Core — the "About you" text, ticket 03. ONE hand-written block per
 * workspace, never updated automatically: only the user's Save writes it.
 */
export const userCore = pgTable("user_core", {
  workspaceId: uuid("workspace_id").primaryKey(),
  text: text("text").notNull().default(""),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
})
