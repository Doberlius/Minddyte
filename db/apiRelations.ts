import {relations} from "drizzle-orm"
import {
    collections,
    sessions,
    messages,
    nodes,
    graphPositions,
    sessionNodes,
    messageNodes,
    collectionNodes,
} from "./schema"

export const collectionsRelations = relations(collections, ({many}) => ({
  sessions: many(sessions),
  collectionNodes: many(collectionNodes),
}));

export const sessionsRelations = relations(sessions, ({one, many}) => ({
  collection: one(collections,
     {fields: [sessions.collectionId], references: [collections.id]}
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
  collectionNodes: many(collectionNodes),
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

export const collectionNodesRelations = relations(collectionNodes, ({one}) => ({
  collection: one(collections, 
    {fields: [collectionNodes.collectionId], references: [collections.id]}
  ),
  node: one(nodes, 
    {fields: [collectionNodes.nodeId], references: [nodes.id]}
  ),
}))
