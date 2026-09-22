'use client'

import { useEffect, useMemo, useRef } from 'react'
import {
  ReactFlow,
  Background,
  BaseEdge,
  Controls,
  Handle,
  Position,
  getStraightPath,
  useInternalNode,
  useReactFlow,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { MessageSquare } from 'lucide-react'
import type { DemoGraph } from '@/demo/graph'
import { layoutGraph } from '@/demo/layout'

/**
 * The canvas.
 *
 * The graph is bipartite — conversations and concepts, with links only between
 * the two kinds, never within one. There is no concept-to-concept edge here
 * because there is none in the product either: two conversations are related
 * when they hold the same concept, and that relationship is already drawn by
 * the two edges meeting at that concept.
 */

type ChatData = {
  label: string
  messageCount: number
  isYours: boolean
  /** deriveTitle caps a title at 60 characters, which can land mid-clause. */
  truncated: boolean
}
type ConceptData = { label: string; chatCount: number; isNew: boolean }

/** Edges need somewhere to attach; nothing here should be draggable by a handle. */
const HIDDEN_HANDLE = { opacity: 0, pointerEvents: 'none' as const }

function ChatNode({ data }: NodeProps) {
  const { label, messageCount, isYours, truncated } = data as unknown as ChatData
  return (
    <div
      style={{
        maxWidth: 190,
        padding: '10px 13px',
        borderRadius: 10,
        background: isYours ? 'var(--violet)' : 'var(--white)',
        color: isYours ? '#fff' : 'var(--ink)',
        border: `1px solid ${isYours ? 'var(--violet)' : 'var(--border)'}`,
        boxShadow: '0 1px 3px rgba(26,26,46,.07)',
      }}
    >
      <Handle type="target" position={Position.Top} style={HIDDEN_HANDLE} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
        <MessageSquare size={11} style={{ opacity: 0.7, flexShrink: 0 }} />
        <span
          style={{
            fontSize: 10,
            textTransform: 'uppercase',
            letterSpacing: '.06em',
            opacity: 0.65,
          }}
        >
          {isYours ? 'your conversation' : 'conversation'}
        </span>
      </div>
      <div
        style={{
          fontSize: 12.5,
          fontWeight: 600,
          lineHeight: 1.35,
          fontFamily: "'Fraunces',serif",
          display: '-webkit-box',
          WebkitLineClamp: 3,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}
      >
        {/* A title cut at the cap reads as a broken page without this; the
            ellipsis says the cut was deliberate. */}
        {truncated ? `${label}…` : label}
      </div>
      <div style={{ fontSize: 10.5, opacity: 0.6, marginTop: 4 }}>
        {messageCount} message{messageCount === 1 ? '' : 's'}
      </div>
      <Handle type="source" position={Position.Bottom} style={HIDDEN_HANDLE} />
    </div>
  )
}

function ConceptNode({ data }: NodeProps) {
  const { label, chatCount, isNew } = data as unknown as ConceptData
  const shared = chatCount > 1
  return (
    <div
      className={isNew ? 'pulse' : undefined}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: shared ? '6px 12px' : '4px 10px',
        borderRadius: 999,
        // Weight follows meaning: a concept holding several conversations
        // together is the thing worth looking at, so it is the thing that
        // is filled in.
        background: shared ? 'var(--violet-l)' : 'var(--white)',
        border: `1px solid ${shared ? 'var(--violet-m)' : 'var(--border)'}`,
        color: shared ? 'var(--violet)' : 'var(--ink2)',
        fontSize: shared ? 12 : 11,
        fontWeight: shared ? 600 : 400,
        whiteSpace: 'nowrap',
      }}
    >
      <Handle type="target" position={Position.Top} style={HIDDEN_HANDLE} />
      {label}
      {shared && (
        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            background: 'var(--violet)',
            color: '#fff',
            borderRadius: 999,
            padding: '1px 6px',
          }}
        >
          {chatCount}
        </span>
      )}
      <Handle type="source" position={Position.Bottom} style={HIDDEN_HANDLE} />
    </div>
  )
}

/**
 * A link drawn centre to centre.
 *
 * The built-in edges leave from a fixed handle, so an edge running upward
 * departs from the bottom of its card, loops back around and reads as
 * decoration rather than a connection. Anchoring at the centres instead makes
 * every link point straight at what it joins. The ends are never seen: nodes
 * are painted in a layer above the edges, so each line is covered by the cards
 * it runs between and appears to stop at their borders.
 */
function FloatingEdge({ id, source, target, style, markerEnd }: EdgeProps) {
  const sourceNode = useInternalNode(source)
  const targetNode = useInternalNode(target)

  // Measured sizes arrive a frame after mount; drawing from an unmeasured node
  // would put a line at the origin for that frame.
  if (!sourceNode?.measured.width || !targetNode?.measured.width) return null

  const centre = (n: NonNullable<typeof sourceNode>) => ({
    x: n.internals.positionAbsolute.x + (n.measured.width ?? 0) / 2,
    y: n.internals.positionAbsolute.y + (n.measured.height ?? 0) / 2,
  })

  const s = centre(sourceNode)
  const t = centre(targetNode)
  const [path] = getStraightPath({
    sourceX: s.x,
    sourceY: s.y,
    targetX: t.x,
    targetY: t.y,
  })

  return <BaseEdge id={id} path={path} style={style} markerEnd={markerEnd} />
}

const NODE_TYPES = { chat: ChatNode, concept: ConceptNode }
const EDGE_TYPES = { floating: FloatingEdge }

/**
 * Re-frame the canvas when the graph grows.
 *
 * `fitView` on its own only runs at mount, so the conversation a visitor has
 * just added can land outside the viewport — they send their first message and
 * appear to get nothing back. Animated rather than instant, because the point
 * is to show the new card arriving rather than to teleport the view.
 *
 * Must be rendered INSIDE `<ReactFlow>`: `useReactFlow` reads the store that
 * component provides.
 */
function RefitOnGrowth({ signature }: { signature: string }) {
  const { fitView } = useReactFlow()
  const previous = useRef(signature)

  useEffect(() => {
    if (signature === previous.current) return
    previous.current = signature
    // One tick, so the new node has been measured. Fitting before that frames
    // the previous set and the new card still falls outside.
    const timer = setTimeout(() => void fitView({ padding: 0.18, duration: 420 }), 60)
    return () => clearTimeout(timer)
  }, [signature, fitView])

  return null
}

export function GraphCanvas({
  graph,
  yourChatId,
  newKeys,
}: {
  graph: DemoGraph
  yourChatId: string
  /** Concepts from the visitor's most recent message, so the canvas can pulse them. */
  newKeys: string[]
}) {
  const { nodes, edges } = useMemo(() => {
    const layout = layoutGraph(graph)
    const at = new Map([...layout.chats, ...layout.concepts].map((p) => [p.id, p]))
    const fresh = new Set(newKeys)

    const chatNodes: Node[] = graph.chats.map((chat) => ({
      id: `chat:${chat.id}`,
      type: 'chat',
      position: { x: at.get(chat.id)!.x, y: at.get(chat.id)!.y },
      data: {
        label: chat.title,
        messageCount: chat.messages.length,
        isYours: chat.id === yourChatId,
        truncated: (chat.messages[0]?.content.length ?? 0) > chat.title.length,
      } satisfies ChatData,
      draggable: true,
    }))

    const conceptNodes: Node[] = graph.nodes.map((node) => ({
      id: `node:${node.key}`,
      type: 'concept',
      position: { x: at.get(node.key)!.x, y: at.get(node.key)!.y },
      data: {
        label: node.label,
        chatCount: node.chatIds.length,
        isNew: fresh.has(node.key),
      } satisfies ConceptData,
      draggable: true,
    }))

    const links: Edge[] = graph.nodes.flatMap((node) =>
      node.chatIds.map((chatId) => ({
        id: `${chatId}->${node.key}`,
        type: 'floating',
        source: `chat:${chatId}`,
        target: `node:${node.key}`,
        style: {
          // An edge into a shared concept is the one the visitor is meant to
          // follow, so it is the one given weight; the rest stay quiet.
          stroke: node.chatIds.length > 1 ? '#9B93F0' : '#D8D5E8',
          strokeWidth: node.chatIds.length > 1 ? 2.2 : 1.2,
        },
        animated: fresh.has(node.key),
      })),
    )

    return { nodes: [...chatNodes, ...conceptNodes], edges: links }
  }, [graph, yourChatId, newKeys])

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={NODE_TYPES}
      edgeTypes={EDGE_TYPES}
      fitView
      fitViewOptions={{ padding: 0.18 }}
      minZoom={0.2}
      maxZoom={1.6}
      proOptions={{ hideAttribution: false }}
      style={{ background: 'var(--bg)' }}
    >
      <RefitOnGrowth signature={`${nodes.length}:${edges.length}`} />
      <Background color="var(--violet-m)" gap={26} size={1} />
      <Controls showInteractive={false} />
    </ReactFlow>
  )
}
