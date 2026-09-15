/**
 * Row shapes for the deterministic-graph schema, as JSON (timestamps arrive
 * as ISO strings over the wire, not Date objects).
 *
 * `db/schema.ts` is the source of truth — these mirror it for client code that
 * never imports Drizzle. If the two disagree, the schema is right.
 */

export interface DbCollection {
    id: string,
    title: string,
    category: string,
    description: string | null,
    tags: string[],
    featured: boolean,
    last_active_at: string,
    created_at: string,
    updated_at: string,
}

export interface DbSession {
    id: string,
    title: string,
    preview: string | null,
    collection_id: string | null,
    /** Spec §3.1 — the Chat's memory. Verbatim sentences, record-separated. */
    compaction: string,
    compaction_updated_at: string | null,
    /** Spec §4.4 — set once at creation, never re-derived on rename. */
    headline_node_id: string | null,
    /** Spec §9 — null means inherit the global default. */
    model_id: string | null,
    created_at: string,
    updated_at: string
}

export interface DbMessage {
    id: string,
    session_id: string,
    role: 'user' | 'assistant'
    content: string,
    model_used: string | null,
    created_at: string
}

export interface DbNode {
    id: string,
    label: string,
    /** Spec §4.3 — the Node's identity. `unique (canonical_key)`. */
    canonical_key: string,
    type: string,
    summary: string | null,
    /** Spec §3.1 — how many Chats hold this Node. Denormalized for §6.3. */
    chat_count: number,
    archived_at: string | null,
    last_referenced_at: string,
    created_at: string,
    updated_at: string
}

export interface DbEdge {
    id: string,
    from_node_id: string,
    to_node_id: string,
    /** Spec §3.1 — replaces the old confirmed/suggested `type`. */
    source: 'overlap' | 'bridge' | 'manual',
    relationship_label: string | null,
    created_at: string,
}

export interface DbGraphPosition {
    node_id: string,
    x: number,
    y: number,
    updated_at: string,
}

/** Spec §7.2 — a Cluster is placed once and never recomputed. */
export interface DbClusterOrigin {
    cluster_key: string,
    x: number,
    y: number,
}

/** Spec §3.2 — scoped to ONE Chat. Not the same as DbRejectedPhrase. */
export interface DbForgotten {
    session_id: string,
    node_label: string,
}

/** Spec §3.2 — account-wide, versus DbForgotten which is per-Chat. With
 *  one local user "account-wide" simply means global. */
export interface DbRejectedPhrase {
    phrase: string,
}

export interface DbCollectionNode {
    collection_id: string,
    node_id: string,
}

export interface DbSessionNode {
    session_id: string,
    node_id: string,
    added_at: string
}

export interface DbMessageNode {
    message_id: string,
    node_id: string
}
