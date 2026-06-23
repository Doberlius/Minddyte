export interface DbFolder {
    id: string,
    user_id: string,
    name: string,
    created_at: string,
    updated_at: string
}

export interface DbSession {
    id: string,
    user_id: string,
    title: string,
    preview: string | null,
    cluster_id: string | null,
    created_at: string,
    updated_at: string
}

export interface DbMessage {
    id: string,
    session_id: string,
    user_id: string,
    role: 'user' | 'assistant'
    content: string,
    model_used: string | null,
    created_at: string
}

export interface DbNode {
    id: string,
    user_id: string,
    label: string,
    type: string,
    summary: string | null,
    confidence: number,
    conection_count: number,
    last_referenced_at: string,
    created_at: string,
    updated_at: string
}

export interface DbEdge {
    id: string,
    user_id: string,
    from_node_id: string,
    to_node_id: string,
    type: 'confirmed' | 'suggested',
    confidence: number,
    relationship_label: string | null,
    occurrence_count: number,
    created_at: string,
    updated_at: string,
}

export interface DbCluster {
    id: string,
    user_id: string,
    title: string,
    category: string,
    description: string | null,
    tags: string[],
    featured: boolean,
    folder_id: string | null,
    last_active_at: string,
    created_at: string,
    updated_at: string,
}

export interface DbClusterNode {
    cluster_id: string,
    node_id: string,
}

export interface DbGraphPosition {
    node_id: string,
    user_id: string,
    x: number,
    y: number,
    updated_at: string,
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
