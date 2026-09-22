import type { DemoGraph } from './graph'
import type { ViewGraph } from '@/types/graph'

/**
 * The demo's in-memory graph, in the shape the views read.
 *
 * The adapter is the whole reason the demo can run the application's real
 * Brain and Archive rather than lookalikes of them: `loadGraph` produces this
 * from PGlite rows, this produces it from arrays, and neither view knows or
 * cares which it was handed.
 *
 * It also drops the transcripts. The canvas counts messages and the archive
 * reads the compaction; neither needs the messages themselves, and the app
 * would never send them.
 */
export function toViewGraph(graph: DemoGraph): ViewGraph {
  return {
    chats: graph.chats.map((chat) => ({
      id: chat.id,
      title: chat.title,
      compaction: chat.compaction,
      messageCount: chat.messages.length,
      // deriveTitle caps at 60 characters, so a first message longer than the
      // title it produced is one that was cut.
      titleTruncated: (chat.messages[0]?.content.length ?? 0) > chat.title.length,
      forgotten: chat.forgotten,
    })),
    nodes: graph.nodes.map((node) => ({
      key: node.key,
      label: node.label,
      chatIds: node.chatIds,
    })),
  }
}
