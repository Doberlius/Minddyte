/**
 * The shape retrieveContext returns for each reached Chat. Declared here rather
 * than imported from the service, because `src/lib/` never depends on anything
 * that touches the database — that boundary is what keeps these tests pure.
 */
export type MemoryChat = { title: string; excerpts: string[]; why: string }

/** Each reached chat as a heading, then its verbatim excerpts in conversation order. */
export function buildMemoryBlock(chats: MemoryChat[]): string {
  return chats.map((c) => `## ${c.title}  (${c.why})\n${c.excerpts.join('\n')}`).join('\n\n')
}

/**
 * Spec §6.1. The two modes differ in ONE thing: whether the model may answer
 * from anything other than the memory it was handed. Both fallbacks matter —
 * a focus prompt with no memory must not invite speculation, and an explore
 * prompt with no memory must not imply memory failed.
 */
export function buildSystemPrompt(mode: 'focus' | 'explore', chats: MemoryChat[]): string {
  const memory = buildMemoryBlock(chats)
  return mode === 'focus'
    ? `You are Minddyte. Answer using this conversation and ONLY the memory below.\n\n${
        memory || 'No memory loaded.'
      }`
    : `You are Minddyte, a context-aware assistant. Use the memory below where it helps; you may also draw on general knowledge.\n\n${
        memory || 'No memory loaded — answering from this conversation alone.'
      }`
}
