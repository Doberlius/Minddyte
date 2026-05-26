import {
    db,
    sessions,
    messages,
    nodes,
    edges, 
    graphPositions,
    clusters
} from "../../../db"

import {
    eq,
    and,
    asc,
    or, 
    sql
} from "drizzle-orm"

export async function loadSession(sessionId: string, userId: string){
    return db.query.sessions.findFirst({
        where: and(
            eq(sessions.id, sessionId),
            eq(sessions.userId,userId)
        ),
        with: {
            messages: {
                orderBy: asc(messages.createdAt)
            },
            sessionNodes: {
                with: {node: {
                    columns: {id: true, label: true, type:true}
                }}
            },
        }

    })
};

export async function loadBrainGraph(userId: string){
    const [allNodes, allEdges, positions] = await Promise.all([
        db.select().from(nodes)
            .where(eq(nodes.userId, userId)),
        db.select().from(edges)
            .where(eq(edges.userId, userId)),
        db.select().from(graphPositions)
            .where(eq(graphPositions.userId, userId))
    ])
    return {nodes: allNodes, edges: allEdges, positions}
}

export async function upsertGraphPosition(nodeId: string, userId: string, x: number, y: number){
    return db.insert(graphPositions)
        .values({nodeId, userId, x, y})
        .onConflictDoUpdate({
            target: graphPositions.nodeId,
            set: {x, y, updatedAt: new Date()}
        })
}

export async function solidifyEdge(nodeAId: string, nodeBId: string){
    return db.update(edges)
        .set({occurrenceCount: sql `
            ${edges.occurrenceCount} + 1
        `, updatedAt: new Date()})
        .where(or(
            and(
                eq(edges.fromNodeId, nodeAId),
                eq(edges.toNodeId, nodeBId),
            ),
            and(
                eq(edges.fromNodeId, nodeBId),
                eq(edges.toNodeId, nodeAId),
            )
        ))
}

export async function deleteCluster(clusterId: string, userId: string){
    return db.delete(clusters)
        .where(and(
            eq(clusters.id, clusterId),
            eq(clusters.userId, userId),
        ))
}

