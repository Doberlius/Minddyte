import {relations} from "drizzle-orm"
import {
    folders,
    clusters,
    sessions,
    messages,
    nodes,
    graphPositions,
    sessionNodes,
    messageNodes,
    clusterNodes,
} from "./schema"

export const foldersRelations = relations(folders, ({many}) => ({
  clusters: many(clusters),
}));

export const clustersRelations = relations(clusters, ({one, many}) => ({
  folder: one(folders, 
    {fields: [clusters.folderId], references: [folders.id]}
  ),
  sessions: many(sessions),
  clusterNodes: many(clusterNodes),
}));

export const sessionsRelations = relations(sessions, ({one, many}) => ({
  cluster: one(clusters,
     {fields: [sessions.clusterId], references: [clusters.id]}
  ),
  messages: many(messages),
  sessionNodes: many(sessionNodes),
}));

export const messagesRelations = relations(messages, ({one, many}) => ({
  session: one(sessions,
    {fields: [messages.sessionId], references: [sessions.id]}
  ),
  messageNodes: many(messageNodes),
}));

export const nodesRelations = relations(nodes, ({one, many}) => ({
  graphPosition: one(graphPositions,
    {fields: [nodes.id], references: [graphPositions.nodeId]}
  ),
  sessionNodes: many(sessionNodes),
  messageNodes: many(messageNodes),
  clusterNodes: many(clusterNodes),
}))

export const graphPositionsRelations = relations(graphPositions, ({one}) => ({
  node: one(nodes, 
    {fields: [graphPositions.nodeId], references: [nodes.id]}
  ),
  
}));

export const sessionNodesRelations = relations(sessionNodes, ({one}) => ({
  session: one(sessions, 
    {fields: [sessionNodes.sessionId], references: [sessions.id]}
  ),
  node: one(nodes,
    {fields: [sessionNodes.nodeId], references: [nodes.id]}
  ),
}));

export const messageNodesRelations = relations(messageNodes, ({one}) => ({
  message: one(messages,
    {fields: [messageNodes.messageId], references: [messages.id]}
  ),
  node: one(nodes, 
    {fields: [messageNodes.nodeId], references: [nodes.id]}
  ),
}));

export const clusterNodesRelations = relations(clusterNodes, ({one}) => ({
  cluster: one(clusters, 
    {fields: [clusterNodes.clusterId], references: [clusters.id]}
  ),
  node: one(nodes, 
    {fields: [clusterNodes.nodeId], references: [nodes.id]}
  ),
}))

