import { sql } from "drizzle-orm"
import { authUsers } from "drizzle-orm/supabase"
import {
  boolean, check, index, integer, pgTable, primaryKey,
  text, timestamp, unique, uniqueIndex, uuid, customType,
} from "drizzle-orm/pg-core"

const float4 = customType<{ data: number; driverData: number }>({
  dataType() { return "float4" },
})

export const collections = pgTable("collections", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  category: text("category").notNull().default("General"),
  description: text("description"),
  tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
  featured: boolean("featured").notNull().default(false),
  lastActiveAt: timestamp("last_active_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("idx_collections_one_featured").on(t.userId).where(sql`${t.featured} = true`),
  index("idx_collections_user_id").on(t.userId),
])

export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
  title: text("title").notNull().default("New Session"),
  preview: text("preview"),
  collectionId: uuid("collection_id").references(() => collections.id, { onDelete: "set null" }),
  // Spec §3.1 — the Chat's memory lives here.
  compaction: text("compaction").notNull().default(""),
  compactionUpdatedAt: timestamp("compaction_updated_at", { withTimezone: true }),
  // Spec §4.4 — set once at creation, never re-derived on rename.
  headlineNodeId: uuid("headline_node_id"),
  // Spec §9 — null means inherit the global default.
  modelId: text("model_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("idx_sessions_user_id").on(t.userId),
  index("idx_sessions_updated").on(t.userId, t.updatedAt.desc()),
])

export const messages = pgTable("messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  sessionId: uuid("session_id").notNull().references(() => sessions.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
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
  userId: uuid("user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
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
  unique("nodes_canonical_unique").on(t.userId, t.canonicalKey),
  index("idx_nodes_user_id").on(t.userId),
])

export const edges = pgTable("edges", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
  fromNodeId: uuid("from_node_id").notNull().references(() => nodes.id, { onDelete: "cascade" }),
  toNodeId: uuid("to_node_id").notNull().references(() => nodes.id, { onDelete: "cascade" }),
  // Spec §3.1 — replaces the old confirmed/suggested `type`.
  source: text("source").notNull().default("overlap"),
  relationshipLabel: text("relationship_label"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("edges_unique").on(t.userId, t.fromNodeId, t.toNodeId),
  check("edges_no_self_loop", sql`${t.fromNodeId} <> ${t.toNodeId}`),
  check("edges_source_check", sql`${t.source} in ('overlap', 'bridge', 'manual')`),
  index("idx_edges_from_node").on(t.fromNodeId),
])

export const graphPositions = pgTable("graph_positions", {
  nodeId: uuid("node_id").primaryKey().references(() => nodes.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
  x: float4("x").notNull().default(0),
  y: float4("y").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
})

/** Spec §7.2 — a Cluster is placed once and never recomputed. */
export const clusterOrigins = pgTable("cluster_origins", {
  userId: uuid("user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
  clusterKey: text("cluster_key").notNull(),
  x: float4("x").notNull(),
  y: float4("y").notNull(),
}, (t) => [primaryKey({ columns: [t.userId, t.clusterKey] })])

/** Spec §3.2 — scoped to ONE Chat. Not the same as rejectedPhrases. */
export const forgotten = pgTable("forgotten", {
  userId: uuid("user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
  sessionId: uuid("session_id").notNull().references(() => sessions.id, { onDelete: "cascade" }),
  nodeLabel: text("node_label").notNull(),
}, (t) => [primaryKey({ columns: [t.sessionId, t.nodeLabel] })])

/** Spec §3.2 — scoped to the ACCOUNT. Not the same as forgotten. */
export const rejectedPhrases = pgTable("rejected_phrases", {
  userId: uuid("user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
  phrase: text("phrase").notNull(),
}, (t) => [primaryKey({ columns: [t.userId, t.phrase] })])

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
