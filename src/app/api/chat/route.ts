import { streamText, convertToModelMessages, type UIMessage } from "ai"
import { ollama } from "@/lib/ollama"
import { resolveModel } from "@/constants/models"
import { retrieveContext } from "@/services/retrieval"
import { persistMessage, ingestUserMessage } from "@/services/graph"

export async function POST(req: Request) {
  const {
    messages, sessionId, userId, taggedChatIds = [], mode = "explore", model,
  }: {
    messages: UIMessage[]
    sessionId: string
    userId: string
    taggedChatIds?: string[]
    mode?: "focus" | "explore"
    model?: string
  } = await req.json()

  const modelId = resolveModel(model)

  const last = messages[messages.length - 1]
  const draft = last?.parts?.filter((p) => p.type === "text").map((p) => p.text).join("") ?? ""

  // 1. persist the user message
  const messageId = await persistMessage({
    sessionId, userId, role: "user", content: draft,
  })

  // 2. retrieve against the PREVIOUS graph state, then call the model
  const { chats } = await retrieveContext({
    userId, sessionId, mode, taggedChatIds, draftText: draft,
  })

  const memory = chats
    .map((c) => `## ${c.title}  (${c.why})\n${c.compaction}`)
    .join("\n\n")

  const systemPrompt =
    mode === "focus"
      ? `You are Minddyte. Answer using this conversation and ONLY the memory below.\n\n${memory || "No memory loaded."}`
      : `You are Minddyte, a context-aware assistant. Use the memory below where it helps; you may also draw on general knowledge.\n\n${memory || "No memory loaded — answering from this conversation alone."}`

  const result = streamText({
    model: ollama(modelId),
    system: systemPrompt,
    messages: await convertToModelMessages(messages),
    maxOutputTokens: 2048,
    // 3-6. Graph writes happen AFTER the stream. Spec §4.5.
    onFinish: async ({ text }) => {
      await persistMessage({
        sessionId, userId, role: "assistant", content: text, modelUsed: modelId,
      })
      await ingestUserMessage({
        sessionId, userId, messageId, content: draft,
        // The first user message drives the title and Headline. Spec §4.4.
        isFirstMessage: messages.filter((m) => m.role === "user").length === 1,
      })
    },
  })

  return result.toUIMessageStreamResponse()
}
