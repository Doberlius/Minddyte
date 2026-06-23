import { DbSession, DbCluster } from '@/types/db';

export interface Session {
    id: number,
    title: string,
    preview: string,
    time: string,
    nodes: number
}

export interface Node {
    id: number,
    label: string,
    type: string,
    connection: number,
}

export interface SlashCommand {
    cmd: string,
    desc: string
}

export interface ModelEntry {
    id: string,
    label: string,
    size: string,
    downloaded: boolean
}

export interface SessionListItem {
    id: number,
    title: string,
    preview: string,
    time: string
}

export interface GraphNode {
    id: number,
    label: string,
    sub: string,
    x: number,
    y: number,
}

export interface GraphEdge{
    from: number,
    to: number,
    dashed: boolean,
}

export interface ContextMenuState{
    x: number,
    y: number,
    type: 'canvas' | 'node'
    node: GraphNode | null
}

export interface Position {
    x: number,
    y: number
}

export type SessionWithCount = DbSession & {
    node_count: number
}

export type ClusterWithMeta = DbCluster & {
    session_count: number,
    linked_nodes: string[]
}

