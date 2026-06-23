// frontend

export interface Session{
    id: number,
    title: string,
    preview: string,
    time: string,
    nodes: number
}

export interface Node{
    id: number,
    label: string,
    type: string,
    connection: number,
}

export interface SlashCommand{
    cmd: string,
    desc: string
}

export interface ModelEntry{
    id: string,
    label: string,
    size: string,
    downloaded: boolean
}

export interface SessionListItem{
    id: number,
    title: string,
    preview: string,
    time: string
}

export interface Dbfolder{
    id: string,
    user_id: string,
    name: string,
    created_at: string,
    updated_at: string
}

export interface DbSession{
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
    role: 'user' | 'assistant' // assistant = ai
    content: string,
    model_used: string | null,
    created_at: string
}

export interface DbNode{
    id: string,
    user_id: string,
    label: string,
    type: string,
    summary: string | null,
    confidence: number, //0,1 edge
    conection_count: number,
    last_referenced_at: string,
    created_at: string,
    updated_at: string
}

// Junction table = many-many relationship
export interface DbSessionNode {
    session_id: string,
    node_id: string,
    added_at: string
}

export interface DbMessageNode {
    message_id: string,
    node_id: string
}

