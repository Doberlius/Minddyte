import { sql, relations } from "drizzle-orm"

import {
  authUsers,
} from "drizzle-orm/supabase"

import {
  boolean,
  check,
  customType,
  uniqueIndex,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";



const vector = customType<{data: number[]; driverData:string}>({ // store ai memory embedding
  dataType(){
    return "extensions.vector(768)";
  },
  toDriver(value: number[]){
    return `[${value.join(",")}]`;
  },
  fromDriver(value: string){
    return value.slice(1,-1).split(",").map(Number);
  },
});

const float4 = customType<{data: number; driverData: number}>({ // stores normal decimal numbers
  dataType(){
    return "float4";
  },
});

export const folders = pgTable(
  "folders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
    .notNull()
    .references(() => authUsers.id, {onDelete: "cascade"}),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", {withTimezone: true}).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", {withTimezone: true}).notNull().defaultNow(),
  },
  (table) => [
    unique("folders_unique_name").on(table.userId, table.name),
    index("idx_folders_user_id").on(table.userId),
  ],
);

export const clusters = pgTable(
  "clusters",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => authUsers.id, {onDelete: "cascade"}),
    title: text("title").notNull(),
    category: text("category").notNull().default("General"),
    description: text("description"),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    featured: boolean("featured").notNull().default(false),
    folderId: uuid("folder_id")
      .references(()=> folders.id, {onDelete: "set null"}),
    lastActiveAt: timestamp("last_active_at", {withTimezone: true}).notNull().defaultNow(),
    createdAt: timestamp("created_at", {withTimezone: true}).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", {withTimezone: true}).notNull().defaultNow(),
  },
  (table) => [

    uniqueIndex("idx_clusters_one_featured").on(table.userId).where(sql`${table.featured} = true`),

    index("idx_clusters_user_id").on(table.userId),
    index("idx_clusters_last_active").on(table.userId, table.lastActiveAt.desc()),
    index("idx_clusters_folder_id").on(table.folderId),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => authUsers.id, {onDelete: "cascade"}),
    title: text("title").notNull().default("New Session"),
    preview: text("preview"),
    clusterId: uuid("cluster_id")
      .references(() => clusters.id, {onDelete: "set null"}),
    createdAt: timestamp("created_at", {withTimezone: true}).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", {withTimezone: true}).notNull().defaultNow(),
  },
  (table) => [
      index("idx_sessions_user_id").on(table.userId),
      index("idx_sessions_updated").on(table.userId, table.updatedAt.desc()),
      index("idx_sessions_cluster_id").on(table.clusterId),
  ],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id, {onDelete: "cascade"}),
    userId: uuid("user_id")
    .notNull()
    .references(() => authUsers.id, {onDelete: "cascade"}),
    role: text("role").notNull(),
    content: text("content").notNull(),
    modelUsed: text("model_used"),
    createdAt: timestamp("created_at", {withTimezone: true}).notNull().defaultNow(),
  },
  (table) => [
    check("messages_role_check", sql`${table.role} in ('user', 'assistant')`),

    index("idx_messages_session_id").on(table.sessionId),
    index("idx_messages_created").on(table.sessionId, table.createdAt.asc()),
    index("idx_messages_user_id").on(table.userId),
  ],
);

export const nodes = pgTable(
  "nodes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(()=> authUsers.id, {onDelete: "cascade"}),
    label: text("label").notNull(),
    type: text("type").notNull().default("General"),
    summary: text("summary"),
    confidence: float4("confidence").notNull().default(1.0),
    connectionCount: integer("connection_count").notNull().default(0),
    embedding: vector("embedding"),
    lastReferencedAt: timestamp("last_referenced_at", {withTimezone: true}).notNull().defaultNow(),
    createdAt: timestamp("created_at", {withTimezone: true}).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", {withTimezone: true}).notNull().defaultNow(),
  },
  (table) => [
    check("nodes_confidence", sql`${table.confidence} >= 0 and ${table.confidence} <= 1`),

    index("idx_nodes_user_id").on(table.userId),
    index("idx_nodes_last_referenced").on(table.userId, table.lastReferencedAt.desc()),
  ],
);

export const edges = pgTable(
  "edges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(()=> authUsers.id, {onDelete: "cascade"}),
    fromNodeId: uuid("from_node_id")
      .notNull()
      .references(()=> nodes.id, {onDelete: "cascade"}),
    toNodeId: uuid("to_node_id")
      .notNull()
      .references(()=> nodes.id, {onDelete: "cascade"}),
    type: text("type").notNull().default("suggested"),
    confidence: float4("confidence").notNull().default(0.5),
    relationshipLabel: text("relationship_label"),
    occurrenceCount: integer("occurrence_count").notNull().default(1), 
    createdAt: timestamp("created_at", {withTimezone: true}).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", {withTimezone: true}).notNull().defaultNow(),
  },
  (table) => [
    unique("edges_unique").on(table.userId, table.fromNodeId, table.toNodeId),

    check("edges_no_self_loop", sql`${table.fromNodeId} <> ${table.toNodeId}`),
    check("edges_type_check", sql`${table.type} in ('confirmed', 'suggested')`),
    check("edges_confidence", sql`${table.confidence} >= 0 and ${table.confidence} <=1`),

    index("idx_edges_user_id").on(table.userId),
    index("idx_edges_from_node").on(table.fromNodeId),
    index("idx_edges_to_node").on(table.toNodeId),
    index("idx_edges_both_nodes").on(table.fromNodeId, table.toNodeId),
  ],
);

export const graphPositions = pgTable(
  "graph_positions",
  {
    nodeId: uuid("node_id")
      .primaryKey()
      .references(() => nodes.id, {onDelete: "cascade"}),
    userId: uuid("user_id")
      .notNull()
      .references(() => authUsers.id, {onDelete: "cascade"}),
    x: float4("x").notNull().default(0),
    y: float4("y").notNull().default(0),
    updatedAt: timestamp("updated_at", {withTimezone: true}).notNull().defaultNow(),
  },
  (table) => [
    index("idx_graph_positions_user_id").on(table.userId),
  ],
);

export const sessionNodes = pgTable(
  "session_nodes",
  {
    sessionId: uuid("session_id") // PK(composite key)
      .notNull()
      .references(() => sessions.id, {onDelete: "cascade"}),
    nodeId: uuid("node_id") // PK(composite key)
      .notNull()
      .references(() => nodes.id, {onDelete: "cascade"}),
    addedAt: timestamp("added_at", {withTimezone: true}).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({columns: [table.sessionId, table.nodeId]}),
    index("idx_session_nodes_node").on(table.nodeId),
  ],
);

export const messageNodes = pgTable(
  "message_nodes",
  {
    messageId: uuid("message_id") // PK(composite key)
    .notNull()
    .references(() => messages.id, {onDelete: "cascade"}),
    nodeId: uuid("node_id") // PK(composite key)
      .notNull()
      .references(() => nodes.id, {onDelete: "cascade"}),
  },
  (table) => [
    primaryKey({columns: [table.messageId, table.nodeId]}),
    index("idx_message_nodes_node").on(table.nodeId),
  ],
);

export const clusterNodes = pgTable(
  "cluster_nodes",
  {
    clusterId: uuid("cluster_id") // PK(composite key)
      .notNull()
      .references(() => clusters.id, {onDelete: "cascade"}),
    nodeId: uuid("node_id") // PK(composite key)
      .notNull()
      .references(() => nodes.id, {onDelete: "cascade"})
  },
  (table) => [
    primaryKey({columns: [table.clusterId, table.nodeId]}),
    index("idx_cluster_nodes_node").on(table.nodeId),
  ],
);


