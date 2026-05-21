# Editorial AI — Database Design
## PostgreSQL 15 + pgvector via Supabase + Drizzle ORM

> **Merge notes:** Base is `database.md` (old). Applied 5 targeted fixes from `database_new.md`:
> `model_used` moved to messages · `user_id` added to messages · edges unique constraint includes `user_id` · featured cluster uses UNIQUE partial index · migrations output path changed to `./supabase/migrations`

---

## 1. Overview

**Database:** PostgreSQL 15 (Supabase hosted)
**Extensions:** `pgvector` (semantic search), `uuid-ossp` (UUID generation)
**Auth:** Supabase Auth — `auth.users` is managed automatically, all tables reference it
**ORM:** Drizzle ORM (`drizzle-orm` + `drizzle-kit`)
**Row Level Security:** Enabled on all tables — users can only access their own data

### Design Principles
- All primary keys are `uuid` generated via `gen_random_uuid()`
- All timestamps are `timestamptz` (timezone-aware)
- Arrays (`text[]`) used only for simple tag lists — relationships use junction tables
- `embedding vector(768)` columns use `nomic-embed-text` output (768 dimensions)
- Soft deletes NOT used — hard deletes with CASCADE for simplicity
- `user_id` on every table — strict data isolation per user
- Sessions belong to **one** cluster (direct FK) — no junction needed per spec

---

## 2. Entity Relationship Diagram

```
auth.users
    │
    ├─── nodes ──────────────────────────── graph_positions (1:1)
    │       │
    │       ├─── edges (from_node_id / to_node_id — self-referential)
    │       ├─── session_nodes ─────────── sessions
    │       ├─── message_nodes ─────────── messages
    │       └─── cluster_nodes ─────────── clusters ── folders
    │
    ├─── sessions ──── messages
    │         └─────── clusters (cluster_id FK)
    │
    ├─── clusters ──── folders
    └─── folders
```

### Relationship summary

| Table | Relates to | Via | Type |
|---|---|---|---|
| nodes | sessions | session_nodes | many-to-many |
| nodes | messages | message_nodes | many-to-many |
| nodes | clusters | cluster_nodes | many-to-many |
| nodes | edges | from_node_id / to_node_id | self-referential |
| nodes | graph_positions | node_id | one-to-one |
| sessions | clusters | cluster_id FK | many-to-one |
| sessions | messages | session_id | one-to-many |
| clusters | folders | folder_id FK | many-to-one |

---

## 3. Tables

### 3.1 `nodes`

The core unit of the Brain. Every topic the AI learns becomes a node.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `uuid` | PK, DEFAULT gen_random_uuid() | |
| `user_id` | `uuid` | NOT NULL, FK → auth.users(id) CASCADE | Owner |
| `label` | `text` | NOT NULL | Display name e.g. "System Architecture" |
| `type` | `text` | NOT NULL, DEFAULT 'General' | Category: Technical, Research, Philosophy… |
| `summary` | `text` | | AI-generated description |
| `confidence` | `float4` | NOT NULL, DEFAULT 1.0, CHECK (0–1) | Drives edge opacity |
| `connection_count` | `int4` | NOT NULL, DEFAULT 0 | Denormalized — updated by trigger on edge insert/delete |
| `embedding` | `vector(768)` | | nomic-embed-text output, used for similarity search |
| `last_referenced_at` | `timestamptz` | NOT NULL, DEFAULT now() | Updated when node is used as AI context |
| `created_at` | `timestamptz` | NOT NULL, DEFAULT now() | |
| `updated_at` | `timestamptz` | NOT NULL, DEFAULT now() | Updated when summary regenerated |

**Indexes:**
```sql
CREATE INDEX idx_nodes_user_id         ON nodes(user_id);
CREATE INDEX idx_nodes_last_referenced ON nodes(user_id, last_referenced_at DESC);
CREATE INDEX idx_nodes_embedding       ON nodes
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
-- Alternative for smaller datasets (< 1000 rows):
-- CREATE INDEX idx_nodes_embedding ON nodes USING hnsw (embedding vector_cosine_ops);
```

---

### 3.2 `edges`

Connections between nodes. `suggested` = AI proposed (dashed, lower opacity). `confirmed` = solidified after 3+ co-occurrences.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `uuid` | PK, DEFAULT gen_random_uuid() | |
| `user_id` | `uuid` | NOT NULL, FK → auth.users(id) CASCADE | |
| `from_node_id` | `uuid` | NOT NULL, FK → nodes(id) CASCADE | Source node |
| `to_node_id` | `uuid` | NOT NULL, FK → nodes(id) CASCADE | Target node |
| `type` | `text` | NOT NULL, DEFAULT 'suggested' | `'confirmed'` or `'suggested'` |
| `confidence` | `float4` | NOT NULL, DEFAULT 0.5, CHECK (0–1) | 0.5 for new, solidifies to 1.0 |
| `relationship_label` | `text` | | e.g. "shared topic: distributed systems" |
| `occurrence_count` | `int4` | NOT NULL, DEFAULT 1 | Increments when both nodes appear in same session |
| `created_at` | `timestamptz` | NOT NULL, DEFAULT now() | |
| `updated_at` | `timestamptz` | NOT NULL, DEFAULT now() | Updated during solidification |

**Constraints:**
```sql
-- ✦ user_id included — scopes uniqueness per user (fix from new schema)
CONSTRAINT edges_unique        UNIQUE (user_id, from_node_id, to_node_id)
CONSTRAINT edges_no_self_loop  CHECK (from_node_id != to_node_id)
CONSTRAINT edges_type_check    CHECK (type IN ('confirmed', 'suggested'))
CONSTRAINT edges_confidence    CHECK (confidence >= 0 AND confidence <= 1)
```

**Indexes:**
```sql
CREATE INDEX idx_edges_user_id    ON edges(user_id);
CREATE INDEX idx_edges_from_node  ON edges(from_node_id);
CREATE INDEX idx_edges_to_node    ON edges(to_node_id);
CREATE INDEX idx_edges_both_nodes ON edges(from_node_id, to_node_id);  -- covers solidify query
```

---

### 3.3 `sessions`

A single chat conversation.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `uuid` | PK, DEFAULT gen_random_uuid() | |
| `user_id` | `uuid` | NOT NULL, FK → auth.users(id) CASCADE | |
| `title` | `text` | NOT NULL, DEFAULT 'New Session' | User-editable via /rename |
| `preview` | `text` | | 1–2 sentence summary — set by /summarize or auto |
| `cluster_id` | `uuid` | FK → clusters(id) SET NULL | Null until saved to archive |
| `created_at` | `timestamptz` | NOT NULL, DEFAULT now() | |
| `updated_at` | `timestamptz` | NOT NULL, DEFAULT now() | Updated on every new message via trigger |

**Indexes:**
```sql
CREATE INDEX idx_sessions_user_id    ON sessions(user_id);
CREATE INDEX idx_sessions_updated    ON sessions(user_id, updated_at DESC);
CREATE INDEX idx_sessions_cluster_id ON sessions(cluster_id);
```

---

### 3.4 `messages`

Individual messages within a session. Append-only — never updated after insert.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `uuid` | PK, DEFAULT gen_random_uuid() | |
| `session_id` | `uuid` | NOT NULL, FK → sessions(id) CASCADE | Parent session |
| `user_id` | `uuid` | NOT NULL, FK → auth.users(id) CASCADE | ✦ Added for direct RLS without joins |
| `role` | `text` | NOT NULL | `'user'` or `'assistant'` |
| `content` | `text` | NOT NULL | Full message in markdown |
| `model_used` | `text` | | ✦ Ollama model tag — only set on assistant messages. Moved from sessions because model can switch mid-session. |
| `created_at` | `timestamptz` | NOT NULL, DEFAULT now() | Message ordering column |

**Constraints:**
```sql
CONSTRAINT messages_role_check CHECK (role IN ('user', 'assistant'))
```

**Indexes:**
```sql
CREATE INDEX idx_messages_session_id ON messages(session_id);
CREATE INDEX idx_messages_created    ON messages(session_id, created_at ASC);
CREATE INDEX idx_messages_user_id    ON messages(user_id);
```

---

### 3.5 `clusters`

A thematic group of sessions — shown in Memory Archives.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `uuid` | PK, DEFAULT gen_random_uuid() | |
| `user_id` | `uuid` | NOT NULL, FK → auth.users(id) CASCADE | |
| `title` | `text` | NOT NULL | e.g. "The Ethics of Autonomous Agents" |
| `category` | `text` | NOT NULL, DEFAULT 'General' | e.g. PHILOSOPHY, CODING, RESEARCH |
| `description` | `text` | | AI-generated, 2 sentences max |
| `tags` | `text[]` | NOT NULL, DEFAULT '{}' | e.g. ["Philosophy", "Frameworks"] |
| `featured` | `boolean` | NOT NULL, DEFAULT false | Active focus — shown as hero card |
| `folder_id` | `uuid` | FK → folders(id) SET NULL | Optional folder |
| `last_active_at` | `timestamptz` | NOT NULL, DEFAULT now() | Updated when a session in this cluster is opened |
| `created_at` | `timestamptz` | NOT NULL, DEFAULT now() | |
| `updated_at` | `timestamptz` | NOT NULL, DEFAULT now() | |

**Indexes:**
```sql
CREATE INDEX idx_clusters_user_id     ON clusters(user_id);
CREATE INDEX idx_clusters_last_active ON clusters(user_id, last_active_at DESC);
CREATE INDEX idx_clusters_folder_id   ON clusters(folder_id);

-- ✦ UNIQUE partial index — enforces only one featured cluster per user at DB level (fix from new schema)
CREATE UNIQUE INDEX idx_clusters_one_featured ON clusters(user_id) WHERE featured = true;
```

---

### 3.6 `folders`

Organizational containers for clusters.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `uuid` | PK, DEFAULT gen_random_uuid() | |
| `user_id` | `uuid` | NOT NULL, FK → auth.users(id) CASCADE | |
| `name` | `text` | NOT NULL | e.g. "Coding", "Research" |
| `created_at` | `timestamptz` | NOT NULL, DEFAULT now() | |
| `updated_at` | `timestamptz` | NOT NULL, DEFAULT now() | |

**Constraints:**
```sql
CONSTRAINT folders_unique_name UNIQUE (user_id, name)
```

**Indexes:**
```sql
CREATE INDEX idx_folders_user_id ON folders(user_id);
```

---

### 3.7 `graph_positions`

Node (x, y) positions on the Brain canvas. Written on every drag — separate table to avoid re-indexing the full nodes row.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `node_id` | `uuid` | PK, FK → nodes(id) CASCADE | One-to-one with nodes |
| `user_id` | `uuid` | NOT NULL, FK → auth.users(id) CASCADE | |
| `x` | `float4` | NOT NULL, DEFAULT 0 | Canvas x in pixels |
| `y` | `float4` | NOT NULL, DEFAULT 0 | Canvas y in pixels |
| `updated_at` | `timestamptz` | NOT NULL, DEFAULT now() | Debounce-updated (500ms) on drag |

**Indexes:**
```sql
CREATE INDEX idx_graph_positions_user_id ON graph_positions(user_id);
```

---

## 4. Junction Tables

### 4.1 `session_nodes`

Which nodes are active for a session as a whole — drives the "2 nodes" badge in the sidebar and auto-loads context when a session is continued from Archive.

| Column | Type | Constraints |
|---|---|---|
| `session_id` | `uuid` | PK (composite), FK → sessions(id) CASCADE |
| `node_id` | `uuid` | PK (composite), FK → nodes(id) CASCADE |
| `added_at` | `timestamptz` | NOT NULL, DEFAULT now() |

```sql
PRIMARY KEY (session_id, node_id)
CREATE INDEX idx_session_nodes_node ON session_nodes(node_id);
```

---

### 4.2 `message_nodes`

Which nodes were used as AI context for a specific message — audit trail, per-message granularity.

| Column | Type | Constraints |
|---|---|---|
| `message_id` | `uuid` | PK (composite), FK → messages(id) CASCADE |
| `node_id` | `uuid` | PK (composite), FK → nodes(id) CASCADE |

```sql
PRIMARY KEY (message_id, node_id)
CREATE INDEX idx_message_nodes_node ON message_nodes(node_id);
```

---

### 4.3 `cluster_nodes`

Which nodes are linked to a cluster — set during cluster generation.

| Column | Type | Constraints |
|---|---|---|
| `cluster_id` | `uuid` | PK (composite), FK → clusters(id) CASCADE |
| `node_id` | `uuid` | PK (composite), FK → nodes(id) CASCADE |

```sql
PRIMARY KEY (cluster_id, node_id)
CREATE INDEX idx_cluster_nodes_node ON cluster_nodes(node_id);
```

---

## 5. pgvector Setup

### 5.1 Enable extension

```sql
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
```

### 5.2 `match_nodes` — semantic search per message

Used by `/api/chat` before each message to find the most relevant nodes from all of the user's nodes without loading them all.

```sql
CREATE OR REPLACE FUNCTION match_nodes(
  query_embedding  vector(768),
  match_threshold  float,
  match_count      int,
  p_user_id        uuid
)
RETURNS TABLE (id uuid, label text, summary text, type text, similarity float)
LANGUAGE sql STABLE AS $$
  SELECT id, label, summary, type,
    1 - (embedding <=> query_embedding) AS similarity
  FROM nodes
  WHERE
    user_id = p_user_id
    AND embedding IS NOT NULL
    AND 1 - (embedding <=> query_embedding) > match_threshold
  ORDER BY embedding <=> query_embedding
  LIMIT match_count;
$$;
```

**Usage:**
```typescript
const { data } = await supabase.rpc('match_nodes', {
  query_embedding: queryEmbedding,  // number[768] from nomic-embed-text
  match_threshold: 0.75,
  match_count: 8,
  p_user_id: userId,
})
```

### 5.3 `match_nodes_for_session` — restore context on session reopen

Used when user clicks "Continue →" from Archive — loads the nodes that were active in that session.

```sql
CREATE OR REPLACE FUNCTION match_nodes_for_session(
  p_session_id  uuid,
  p_user_id     uuid,
  match_count   int DEFAULT 5
)
RETURNS TABLE (id uuid, label text, type text)
LANGUAGE sql STABLE AS $$
  SELECT DISTINCT n.id, n.label, n.type
  FROM session_nodes sn
  JOIN nodes n ON n.id = sn.node_id
  WHERE sn.session_id = p_session_id
    AND n.user_id = p_user_id
  LIMIT match_count;
$$;
```

---

## 6. Row Level Security (RLS)

```sql
ALTER TABLE nodes           ENABLE ROW LEVEL SECURITY;
ALTER TABLE edges           ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages        ENABLE ROW LEVEL SECURITY;
ALTER TABLE clusters        ENABLE ROW LEVEL SECURITY;
ALTER TABLE folders         ENABLE ROW LEVEL SECURITY;
ALTER TABLE graph_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_nodes   ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_nodes   ENABLE ROW LEVEL SECURITY;
ALTER TABLE cluster_nodes   ENABLE ROW LEVEL SECURITY;
```

**Direct tables — same pattern for all:**
```sql
-- Applied identically to: nodes, edges, sessions, clusters, folders, graph_positions
CREATE POLICY "users can view own nodes"   ON nodes FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "users can insert own nodes" ON nodes FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "users can update own nodes" ON nodes FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "users can delete own nodes" ON nodes FOR DELETE USING (auth.uid() = user_id);

-- ✦ messages now has user_id — direct policy, no join needed
CREATE POLICY "users can view own messages"   ON messages FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "users can insert own messages" ON messages FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "users can delete own messages" ON messages FOR DELETE USING (auth.uid() = user_id);
```

**Junction tables — access via parent:**
```sql
CREATE POLICY "session_nodes via session owner"
  ON session_nodes FOR ALL
  USING (EXISTS (
    SELECT 1 FROM sessions WHERE id = session_id AND user_id = auth.uid()
  ));

CREATE POLICY "message_nodes via message owner"
  ON message_nodes FOR ALL
  USING (EXISTS (
    SELECT 1 FROM messages WHERE id = message_id AND user_id = auth.uid()
  ));

CREATE POLICY "cluster_nodes via cluster owner"
  ON cluster_nodes FOR ALL
  USING (EXISTS (
    SELECT 1 FROM clusters WHERE id = cluster_id AND user_id = auth.uid()
  ));
```

---

## 7. Triggers & Automation

### 7.1 Reusable `updated_at` function

```sql
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_nodes_updated_at      BEFORE UPDATE ON nodes      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_sessions_updated_at   BEFORE UPDATE ON sessions   FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_clusters_updated_at   BEFORE UPDATE ON clusters   FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_edges_updated_at      BEFORE UPDATE ON edges      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_folders_updated_at    BEFORE UPDATE ON folders    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_positions_updated_at  BEFORE UPDATE ON graph_positions FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

### 7.2 Auto-update `sessions.updated_at` on new message

```sql
CREATE OR REPLACE FUNCTION bump_session_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE sessions SET updated_at = now() WHERE id = NEW.session_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_messages_bump_session
  AFTER INSERT ON messages
  FOR EACH ROW EXECUTE FUNCTION bump_session_updated_at();
```

### 7.3 Auto-create `graph_positions` row on node insert

```sql
CREATE OR REPLACE FUNCTION create_graph_position()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO graph_positions (node_id, user_id, x, y)
  VALUES (NEW.id, NEW.user_id, (random() * 600)::float4, (random() * 400)::float4);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_node_create_position
  AFTER INSERT ON nodes
  FOR EACH ROW EXECUTE FUNCTION create_graph_position();
```

### 7.4 Auto-update `connection_count` on edge insert/delete

```sql
CREATE OR REPLACE FUNCTION update_node_connection_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE nodes SET connection_count = connection_count + 1
      WHERE id = NEW.from_node_id OR id = NEW.to_node_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE nodes SET connection_count = GREATEST(connection_count - 1, 0)
      WHERE id = OLD.from_node_id OR id = OLD.to_node_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_edges_connection_count
  AFTER INSERT OR DELETE ON edges
  FOR EACH ROW EXECUTE FUNCTION update_node_connection_count();
```

### 7.5 Auto-update `last_referenced_at` on node use

```sql
CREATE OR REPLACE FUNCTION update_node_last_referenced()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE nodes SET last_referenced_at = now() WHERE id = NEW.node_id;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_session_nodes_last_ref
  AFTER INSERT ON session_nodes
  FOR EACH ROW EXECUTE FUNCTION update_node_last_referenced();
```

### 7.6 Auto-solidify edge on 3+ co-occurrences

When `occurrence_count` reaches 3, edge is automatically promoted from `suggested` → `confirmed` and `confidence` → 1.0. No manual approval needed.

```sql
CREATE OR REPLACE FUNCTION solidify_edge()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.occurrence_count >= 3 AND OLD.type = 'suggested' THEN
    NEW.type = 'confirmed';
    NEW.confidence = 1.0;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_edge_solidify
  BEFORE UPDATE ON edges
  FOR EACH ROW EXECUTE FUNCTION solidify_edge();
```

---

## 8. Drizzle ORM Schema

Full schema file — `src/db/schema.ts`:

```typescript
import {
  pgTable, uuid, text, integer, boolean,
  timestamp, index, unique, primaryKey
} from 'drizzle-orm/pg-core'
import { customType, sql } from 'drizzle-orm/pg-core'

// ── pgvector custom type ──────────────────────────────────────────────────────
const vector = customType<{ data: number[]; driverData: string }>({
  dataType() { return 'vector(768)' },
  toDriver(v: number[]): string { return `[${v.join(',')}]` },
  fromDriver(v: string): number[] { return v.slice(1,-1).split(',').map(Number) },
})

const float4 = customType<{ data: number; driverData: number }>({
  dataType() { return 'float4' },
})

// ── folders ───────────────────────────────────────────────────────────────────
export const folders = pgTable('folders', {
  id:        uuid('id').primaryKey().defaultRandom(),
  userId:    uuid('user_id').notNull(),
  name:      text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uniqueName: unique('folders_unique_name').on(t.userId, t.name),
  userIdx:    index('idx_folders_user_id').on(t.userId),
}))

// ── clusters ──────────────────────────────────────────────────────────────────
export const clusters = pgTable('clusters', {
  id:           uuid('id').primaryKey().defaultRandom(),
  userId:       uuid('user_id').notNull(),
  title:        text('title').notNull(),
  category:     text('category').notNull().default('General'),
  description:  text('description'),
  tags:         text('tags').array().notNull().default(sql`'{}'::text[]`),
  featured:     boolean('featured').notNull().default(false),
  folderId:     uuid('folder_id').references(() => folders.id, { onDelete: 'set null' }),
  lastActiveAt: timestamp('last_active_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt:    timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  userIdx:       index('idx_clusters_user_id').on(t.userId),
  lastActiveIdx: index('idx_clusters_last_active').on(t.userId, t.lastActiveAt),
  folderIdx:     index('idx_clusters_folder_id').on(t.folderId),
  // ✦ UNIQUE partial index enforced via raw SQL migration (Drizzle cannot generate partial unique indexes)
  // CREATE UNIQUE INDEX idx_clusters_one_featured ON clusters(user_id) WHERE featured = true;
}))

// ── nodes ─────────────────────────────────────────────────────────────────────
export const nodes = pgTable('nodes', {
  id:               uuid('id').primaryKey().defaultRandom(),
  userId:           uuid('user_id').notNull(),
  label:            text('label').notNull(),
  type:             text('type').notNull().default('General'),
  summary:          text('summary'),
  confidence:       float4('confidence').notNull().default(1.0),
  connectionCount:  integer('connection_count').notNull().default(0),
  embedding:        vector('embedding'),
  lastReferencedAt: timestamp('last_referenced_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt:        timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:        timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  userIdx:    index('idx_nodes_user_id').on(t.userId),
  lastRefIdx: index('idx_nodes_last_referenced').on(t.userId, t.lastReferencedAt),
  // ivfflat index created via raw SQL migration — not supported by Drizzle
  // CREATE INDEX idx_nodes_embedding ON nodes USING ivfflat (embedding vector_cosine_ops) WITH (lists=100);
}))

// ── edges ─────────────────────────────────────────────────────────────────────
export const edges = pgTable('edges', {
  id:                uuid('id').primaryKey().defaultRandom(),
  userId:            uuid('user_id').notNull(),
  fromNodeId:        uuid('from_node_id').notNull().references(() => nodes.id, { onDelete: 'cascade' }),
  toNodeId:          uuid('to_node_id').notNull().references(() => nodes.id, { onDelete: 'cascade' }),
  type:              text('type').notNull().default('suggested'),
  confidence:        float4('confidence').notNull().default(0.5),
  relationshipLabel: text('relationship_label'),
  occurrenceCount:   integer('occurrence_count').notNull().default(1),
  createdAt:         timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:         timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  // ✦ user_id included in unique constraint (fix from new schema)
  uniqueEdge:    unique('edges_unique').on(t.userId, t.fromNodeId, t.toNodeId),
  userIdx:       index('idx_edges_user_id').on(t.userId),
  fromIdx:       index('idx_edges_from_node').on(t.fromNodeId),
  toIdx:         index('idx_edges_to_node').on(t.toNodeId),
  bothNodesIdx:  index('idx_edges_both_nodes').on(t.fromNodeId, t.toNodeId),
}))

// ── sessions ──────────────────────────────────────────────────────────────────
export const sessions = pgTable('sessions', {
  id:        uuid('id').primaryKey().defaultRandom(),
  userId:    uuid('user_id').notNull(),
  title:     text('title').notNull().default('New Session'),
  preview:   text('preview'),
  clusterId: uuid('cluster_id').references(() => clusters.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  userIdx:    index('idx_sessions_user_id').on(t.userId),
  updatedIdx: index('idx_sessions_updated').on(t.userId, t.updatedAt),
  clusterIdx: index('idx_sessions_cluster_id').on(t.clusterId),
}))

// ── messages ──────────────────────────────────────────────────────────────────
export const messages = pgTable('messages', {
  id:        uuid('id').primaryKey().defaultRandom(),
  sessionId: uuid('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  userId:    uuid('user_id').notNull(),       // ✦ added for direct RLS
  role:      text('role').notNull(),
  content:   text('content').notNull(),
  modelUsed: text('model_used'),              // ✦ moved from sessions — records per-message model
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  sessionIdx: index('idx_messages_session_id').on(t.sessionId),
  createdIdx: index('idx_messages_created').on(t.sessionId, t.createdAt),
  userIdx:    index('idx_messages_user_id').on(t.userId),
}))

// ── graph_positions ───────────────────────────────────────────────────────────
export const graphPositions = pgTable('graph_positions', {
  nodeId:    uuid('node_id').primaryKey().references(() => nodes.id, { onDelete: 'cascade' }),
  userId:    uuid('user_id').notNull(),
  x:         float4('x').notNull().default(0),
  y:         float4('y').notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  userIdx: index('idx_graph_positions_user_id').on(t.userId),
}))

// ── junction: session_nodes ───────────────────────────────────────────────────
export const sessionNodes = pgTable('session_nodes', {
  sessionId: uuid('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  nodeId:    uuid('node_id').notNull().references(() => nodes.id, { onDelete: 'cascade' }),
  addedAt:   timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  pk:      primaryKey({ columns: [t.sessionId, t.nodeId] }),
  nodeIdx: index('idx_session_nodes_node').on(t.nodeId),
}))

// ── junction: message_nodes ───────────────────────────────────────────────────
export const messageNodes = pgTable('message_nodes', {
  messageId: uuid('message_id').notNull().references(() => messages.id, { onDelete: 'cascade' }),
  nodeId:    uuid('node_id').notNull().references(() => nodes.id, { onDelete: 'cascade' }),
}, (t) => ({
  pk:      primaryKey({ columns: [t.messageId, t.nodeId] }),
  nodeIdx: index('idx_message_nodes_node').on(t.nodeId),
}))

// ── junction: cluster_nodes ───────────────────────────────────────────────────
export const clusterNodes = pgTable('cluster_nodes', {
  clusterId: uuid('cluster_id').notNull().references(() => clusters.id, { onDelete: 'cascade' }),
  nodeId:    uuid('node_id').notNull().references(() => nodes.id, { onDelete: 'cascade' }),
}, (t) => ({
  pk:      primaryKey({ columns: [t.clusterId, t.nodeId] }),
  nodeIdx: index('idx_cluster_nodes_node').on(t.nodeId),
}))
```

---

## 9. Drizzle Config

`drizzle.config.ts`:
```typescript
import type { Config } from 'drizzle-kit'

export default {
  schema:        './src/db/schema.ts',
  out:           './supabase/migrations',   // ✦ integrates with Supabase CLI
  dialect:       'postgresql',
  dbCredentials: {
    // ✦ Transaction Pooler (port 6543) — required for Vercel serverless
    // Supabase dashboard → Settings → Database → Connection string → Transaction pooler
    url: process.env.DATABASE_URL!,
  },
} satisfies Config
```

**`.env.local`:**
```bash
# Transaction Pooler — use this for Vercel, not the direct connection
DATABASE_URL=postgresql://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres
```

**Commands:**
```bash
bunx drizzle-kit generate   # generate migration files from schema changes
bunx drizzle-kit migrate    # apply migrations to Supabase
bunx drizzle-kit push       # push schema directly (dev only, no migration files)
bunx drizzle-kit studio     # open visual DB browser at localhost:4983

# Generate TypeScript types directly from Supabase schema
bunx supabase gen types typescript --project-id YOUR_PROJECT_ID > src/types/database.ts
```

---

## 10. Key Queries (Drizzle TypeScript)

### Load session list for sidebar
```typescript
const result = await db.query.sessions.findMany({
  where: eq(sessions.userId, userId),
  orderBy: desc(sessions.updatedAt),
  columns: { id: true, title: true, preview: true, updatedAt: true },
  with: {
    sessionNodes: { columns: { nodeId: true } }
  }
})
// node count = result[i].sessionNodes.length
```

### Load full session with messages
```typescript
const session = await db.query.sessions.findFirst({
  where: and(eq(sessions.id, sessionId), eq(sessions.userId, userId)),
  with: {
    messages: { orderBy: asc(messages.createdAt) },
    sessionNodes: { with: { node: { columns: { id: true, label: true, type: true } } } }
  }
})
```

### Load Brain graph (nodes + edges + positions)
```typescript
const [allNodes, allEdges, positions] = await Promise.all([
  db.select().from(nodes).where(eq(nodes.userId, userId)),
  db.select().from(edges).where(eq(edges.userId, userId)),
  db.select().from(graphPositions).where(eq(graphPositions.userId, userId)),
])
```

### Upsert graph position (debounced on drag)
```typescript
await db.insert(graphPositions)
  .values({ nodeId, userId, x, y })
  .onConflictDoUpdate({
    target: graphPositions.nodeId,
    set: { x, y, updatedAt: new Date() }
  })
```

### Solidify edge (increment occurrence_count — trigger fires automatically)
```typescript
await db.update(edges)
  .set({
    occurrenceCount: sql`${edges.occurrenceCount} + 1`,
    updatedAt: new Date(),
  })
  .where(
    or(
      and(eq(edges.fromNodeId, nodeAId), eq(edges.toNodeId, nodeBId)),
      and(eq(edges.fromNodeId, nodeBId), eq(edges.toNodeId, nodeAId))
    )
  )
// trg_edge_solidify fires automatically — promotes to 'confirmed' at occurrenceCount >= 3
```

### Delete cluster
```typescript
// Sessions keep their messages — cluster_id set to null via FK SET NULL
await db.delete(clusters)
  .where(and(eq(clusters.id, clusterId), eq(clusters.userId, userId)))
// cluster_nodes cascade-deleted automatically
```

---

## 11. Migration Commands

```bash
bunx drizzle-kit generate   # generate migration files from schema changes
bunx drizzle-kit migrate    # apply migrations to Supabase
bunx drizzle-kit push       # push schema directly (dev only)
bunx drizzle-kit studio     # visual DB browser

# After Drizzle migration, run these in Supabase SQL editor:
# 1. CREATE EXTENSION IF NOT EXISTS vector;
# 2. ivfflat index (Section 3.1)
# 3. UNIQUE partial index for featured cluster (Section 3.5)
# 4. All trigger functions (Section 7)
# 5. match_nodes functions (Section 5)
# 6. RLS policies (Section 6)
```

---

## 12. Table Size Estimates

| Table | Grows with | Estimated rows at 1K sessions |
|---|---|---|
| `nodes` | Every new AI-learned topic | ~500–2,000 |
| `edges` | Every node relationship | ~1,000–8,000 |
| `sessions` | Every conversation | ~1,000 |
| `messages` | Every message sent | ~20,000–50,000 |
| `clusters` | Every archive group | ~50–200 |
| `folders` | User-created | ~5–20 |
| `graph_positions` | One per node | ~500–2,000 |
| `session_nodes` | Nodes active per session | ~2,000–8,000 |
| `message_nodes` | Nodes used per message | ~10,000–40,000 |
| `cluster_nodes` | Nodes per cluster | ~200–1,000 |

Largest table: `messages`. Most expensive query: `match_nodes` (vector similarity) — the ivfflat index handles this efficiently up to ~100K nodes.
