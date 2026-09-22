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
import type { ViewGraph } from '@/types/graph'
import { layoutGraph } from '@/lib/graph-layout'

/**
 * The canvas.
 *
 * The graph is bipartite — conversations and concepts, with links only between
 * the two kinds, never within one. There is no concept-to-concept edge here
 * because there is none in the product either: two conversations are related
 * when they hold the same concept, and that relationship is already drawn by
 * the two edges meeting at that concept.
 *
 * Colour does one job: emphasis. A concept several conversations share is the
 * thing worth looking at, so it is the only thing filled in; everything else
 * recedes. Identity is never carried by colour alone — every node wears its
 * own label, which is also what lets the quiet marks stay quiet: the text does
 * the work their borders would otherwise have to.
 *
 * Those borders once did have to, and failed. An earlier pass gave the shared
 * pill a #C7C3F7 outline on the app's surface — 1.58:1, and 11.2 ΔE from the
 * plain card border, under the 15 at which normal colour vision stops telling
 * a pair apart. Fills carry emphasis here for that reason.
 */

type ChatData = {
  label: string
  messageCount: number
  isYours: boolean
  /** What to call a highlighted chat: the demo and the app mean different things. */
  highlightLabel: string
  /** deriveTitle caps a title at 60 characters, which can land mid-clause. */
  truncated: boolean
}
type ConceptData = { label: string; chatCount: number; isNew: boolean }

/** Edges need somewhere to attach; nothing here should be draggable by a handle. */
const HIDDEN_HANDLE = { opacity: 0, pointerEvents: 'none' as const }

function ChatNode({ data }: NodeProps) {
  const { label, messageCount, isYours, highlightLabel, truncated } = data as unknown as ChatData
  return (
    <div
      className="g-node"
      style={{
        width: 208,
        padding: '12px 15px',
        borderRadius: 10,
        background: isYours ? 'var(--violet)' : 'var(--white)',
        border: `1px solid ${isYours ? 'var(--violet)' : 'var(--border)'}`,
        boxShadow: isYours
          ? '0 4px 18px rgba(79,70,232,.28)'
          : '0 1px 4px rgba(26,26,46,.06)',
      }}
    >
      <Handle type="target" position={Position.Top} style={HIDDEN_HANDLE} />
      <div
        className="demo-eyebrow"
        style={{
          // On the violet card this label was white at .8 alpha — 4.58:1, and
          // the line below it at .75 was 4.23:1, under the floor for text this
          // small. .92 keeps them quieter than the title and still legible.
          color: isYours ? 'rgba(255,255,255,.92)' : undefined,
          marginBottom: 7,
        }}
      >
        <MessageSquare size={10} style={{ flexShrink: 0 }} />
        {isYours ? highlightLabel : 'conversation'}
      </div>
      <div
        style={{
          // Sans, not the display serif: at this size a serif under a line
          // clamp turns to mush, and the wordmark is where the serif belongs.
          fontSize: 13,
          fontWeight: 600,
          lineHeight: 1.4,
          letterSpacing: '-.01em',
          color: isYours ? '#fff' : 'var(--ink)',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}
      >
        {/* A title cut at the cap reads as a broken page without this; the
            ellipsis says the cut was deliberate. */}
        {truncated ? `${label}…` : label}
      </div>
      <div
        className="tnum"
        style={{
          fontSize: 10.5,
          marginTop: 7,
          color: isYours ? 'rgba(255,255,255,.92)' : 'var(--ink3)',
        }}
      >
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
      className={`g-node${isNew ? ' pulse' : ''}`}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: shared ? '6px 7px 6px 14px' : '5px 12px',
        borderRadius: 999,
        background: shared ? 'var(--violet)' : 'var(--white)',
        border: `1px solid ${shared ? 'var(--violet)' : 'var(--pill-border)'}`,
        color: shared ? '#fff' : 'var(--ink2)',
        fontSize: shared ? 12.5 : 11.5,
        fontWeight: shared ? 600 : 400,
        whiteSpace: 'nowrap',
        boxShadow: shared ? '0 2px 10px rgba(79,70,232,.22)' : 'none',
      }}
    >
      <Handle type="target" position={Position.Top} style={HIDDEN_HANDLE} />
      {label}
      {shared && (
        <span
          className="tnum"
          style={{
            fontSize: 10.5,
            fontWeight: 600,
            minWidth: 19,
            textAlign: 'center',
            background: 'rgba(255,255,255,.26)',
            borderRadius: 999,
            padding: '2px 6px',
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

type Focus = {
  /** The visitor's card and the concepts their message just produced. */
  near: string[]
  /** Those, plus every conversation that already held one of them. */
  wide: string[]
}

/**
 * Frames the canvas. All of it — there is no `fitView` prop on the flow below.
 *
 * Sharing the job with React Flow's own initial fit did not work. That fit
 * runs when the nodes finish measuring, which is later than any timer started
 * at mount, so a focused frame fired first was silently overwritten and looked
 * exactly like an effect that had never run. `useNodesInitialized`, the hook
 * meant to report that moment, stayed false here for the whole life of the
 * canvas. Rather than time the handover more cleverly, this owns both frames:
 * it waits for the measurements itself and then fits once.
 *
 * What it fits depends on whether the visitor has added anything yet:
 *
 * - Nothing of their own: the whole graph, which is the right opening shot.
 * - Something of their own: their card and what it just joined, because the
 *   question they asked by coming to this tab was "where did MINE go?", and a
 *   wide shot of everything answers a different one.
 *
 * Both frames have a zoom floor. Sixteen nodes fitted into a phone came out as
 * a field of grey specks with not one readable label — a picture of a graph
 * rather than a graph. Clamped, the view crops instead, and the visitor pans.
 *
 * Must be rendered INSIDE `<ReactFlow>`: `useReactFlow` reads the store that
 * component provides.
 */
function FrameCanvas({ signature, focus }: { signature: string; focus: Focus }) {
  const { fitView, getNodes } = useReactFlow()
  // Null rather than the first signature, so this also runs on mount. The
  // common path is not "send a message while watching the graph" — it is send,
  // then come to this tab, which mounts the canvas fresh. Seeded with the
  // current signature, that arrival counted as no change at all.
  const previous = useRef<string | null>(null)

  /**
   * Everything the effect reads except the signature is held in a ref, and the
   * effect depends on the signature alone.
   *
   * It has to. The work below spans several animation frames, and any other
   * dependency re-running the effect would cancel the frame in flight — after
   * which the guard on the first line, doing its job, declined to start
   * another. The result was a fit that was scheduled, cancelled, and never
   * rescheduled: no exception, no warning, and a canvas sitting at its default
   * viewport looking for all the world like code that had not been reached.
   */
  const latest = useRef({ focus, fitView, getNodes })
  latest.current = { focus, fitView, getNodes }

  useEffect(() => {
    if (signature === previous.current) return
    const prior = previous.current
    const first = prior === null
    previous.current = signature

    let raf = 0
    let tries = 0
    /**
     * Whether the frame this run promised was actually delivered.
     *
     * The work spans several animation frames, so a cleanup can land in the
     * middle of it — and in development React mounts, cleans up and mounts
     * again, which is exactly that. Marking the signature as done on the way
     * IN meant the second run saw the job as already handled, while the first
     * run's frame had been cancelled: a fit scheduled, cancelled, and never
     * rescheduled, with no error anywhere to say so. The claim is released
     * here unless the fit really happened.
     */
    let settled = false

    const frame = () => {
      const { focus, fitView, getNodes } = latest.current
      // Positions are known up front; sizes are not, and fitting against
      // unmeasured nodes frames a bounding box of zero-width points.
      const nodes = getNodes()
      const measured = nodes.length > 0 && nodes.every((n) => n.measured?.width)
      if (!measured && tries++ < 90) {
        raf = requestAnimationFrame(frame)
        return
      }

      /**
       * A popular concept like PostgreSQL is held by four conversations, so
       * "your card and everything it reaches" is very nearly the whole graph.
       * On a wide screen that is the right answer. On a phone it reproduces
       * the unreadable wide shot and pushes the violet card the guide bar is
       * pointing at off the left edge, so narrow screens get the tight
       * cluster: the card, its new concepts and their counts, with the edges
       * running off-screen to say there is more.
       */
      const ids =
        focus.wide.length === 0 ? null : window.innerWidth < 760 ? focus.near : focus.wide

      // The real nodes out of the store, not `{ id }` stubs. A stub carries no
      // position or size, so the bounding box came out degenerate and the
      // viewport landed on a part of the graph that had nothing to do with the
      // set — a wrong frame, which reads as a bug rather than as no frame.
      const picked = ids ? nodes.filter((n) => ids.includes(n.id)) : []

      settled = true
      void fitView({
        nodes: picked.length > 0 ? picked : undefined,
        padding: picked.length > 0 ? 0.22 : 0.1,
        minZoom: 0.5,
        // Without a ceiling, a visitor whose message joined a single concept
        // gets those two nodes blown up to fill the screen.
        maxZoom: picked.length > 0 ? 1 : 1.6,
        // The opening frame is where the graph already was; only a later one
        // is a move worth watching.
        duration: first ? 0 : 420,
      })
    }

    raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(raf)
      if (!settled) previous.current = prior
    }
  }, [signature])

  return null
}

export function GraphCanvas({
  graph,
  highlight,
  highlightLabel,
  focusId,
  newKeys,
}: {
  graph: ViewGraph
  /** Conversations to fill violet: the demo's own, the app's open one. */
  highlight: string[]
  /** The eyebrow a filled card wears, which is what the fill MEANS here. */
  highlightLabel: string
  /** The open conversation, which is what a refit frames. */
  focusId: string | null
  /** Concepts from the visitor's most recent message, so the canvas can pulse them. */
  newKeys: string[]
}) {
  const { nodes, edges, focus } = useMemo(() => {
    const layout = layoutGraph(graph)
    const at = new Map([...layout.chats, ...layout.concepts].map((p) => [p.id, p]))
    const fresh = new Set(newKeys)

    const chatNodes: Node[] = graph.chats.map((chat) => ({
      id: `chat:${chat.id}`,
      type: 'chat',
      position: { x: at.get(chat.id)!.x, y: at.get(chat.id)!.y },
      data: {
        label: chat.title,
        messageCount: chat.messageCount,
        isYours: highlight.includes(chat.id),
        highlightLabel,
        truncated: chat.titleTruncated,
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
          stroke: node.chatIds.length > 1 ? 'var(--line-strong)' : 'var(--line-quiet)',
          strokeWidth: node.chatIds.length > 1 ? 1.9 : 1.1,
        },
        animated: fresh.has(node.key),
      })),
    )

    /**
     * What the next refit should frame: the visitor's card, the concepts their
     * last message produced, and every conversation that already held one of
     * them. That set IS the claim — "your words reached these other
     * conversations, by themselves" — so it is exactly what the viewport
     * should contain.
     */
    const near =
      newKeys.length === 0 || !focusId ? [] : [`chat:${focusId}`, ...newKeys.map((key) => `node:${key}`)]
    const wide =
      near.length === 0
        ? []
        : [
            ...near,
            ...graph.nodes
              .filter((node) => fresh.has(node.key))
              .flatMap((node) => node.chatIds.map((chatId) => `chat:${chatId}`)),
          ]

    const focus: Focus = { near, wide: [...new Set(wide)] }

    return { nodes: [...chatNodes, ...conceptNodes], edges: links, focus }
  }, [graph, highlight, highlightLabel, focusId, newKeys])

  return (
    <ReactFlow
      className="demo-flow"
      aria-label="Graph of every conversation and the concepts they share"
      nodes={nodes}
      edges={edges}
      nodeTypes={NODE_TYPES}
      edgeTypes={EDGE_TYPES}
      // No `fitView` prop: `FrameCanvas` below owns every framing decision,
      // including the first one. Two of them competing is what broke this.
      //
      // `minZoom` stays lower than the floor those frames use, so the Controls'
      // zoom-out and fit buttons can still pull back to the whole graph.
      minZoom={0.25}
      maxZoom={1.6}
      proOptions={{ hideAttribution: false }}
      style={{ background: 'var(--bg)' }}
    >
      <FrameCanvas signature={`${nodes.length}:${edges.length}:${newKeys.join(',')}`} focus={focus} />
      {/* Literal, not a token: the dot is an SVG `fill` attribute, where a CSS
          custom property does not resolve. */}
      <Background color="#D7D9E6" gap={26} size={1} />
      <Controls showInteractive={false} />
    </ReactFlow>
  )
}
