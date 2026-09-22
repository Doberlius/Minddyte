import type { GraphNode } from '@/types/graph'

/** Two chats and every Node they have in common. Nobody drew these — they follow from content. */
export type Overlap = { a: string; b: string; keys: string[] }

/**
 * The connections that simply follow from content: two chats holding the same
 * Node. One entry per pair, carrying every key they share, so the canvas draws
 * a single edge whose weight is `keys.length` rather than a bundle of parallel
 * lines nobody can read.
 */
/**
 * Takes only the nodes, not a whole graph: the links fall out of which chats
 * hold which concepts, and nothing else here is read. Narrowing the parameter
 * is what lets the demo's in-memory graph and the app's database rows both be
 * passed straight in without an adapter.
 */
export function overlaps(graph: { nodes: GraphNode[] }): Overlap[] {
  const pairs = new Map<string, Overlap>()

  for (const node of graph.nodes) {
    if (node.chatIds.length < 2) continue
    for (let i = 0; i < node.chatIds.length; i++) {
      for (let j = i + 1; j < node.chatIds.length; j++) {
        const a = node.chatIds[i]
        const b = node.chatIds[j]
        const id = `${a}|${b}`
        const found = pairs.get(id)
        if (found) found.keys.push(node.key)
        else pairs.set(id, { a, b, keys: [node.key] })
      }
    }
  }

  return [...pairs.values()]
}
