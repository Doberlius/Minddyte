import { streamText, convertToModelMessages, type UIMessage } from "ai"
import { ollama } from "@/lib/ollama"
import { resolveModel } from "@/constants/models"
import { retrieveContext } from "@/services/retrieval"
import { persistMessage, ingestUserMessage } from "@/services/graph"
import { RECORD_SEPARATOR } from "@/lib/compaction"

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
  if (!last || last.role !== "user") {
    return Response.json({ error: "last message must be a user message" }, { status: 400 })
  }
  const draft = last?.parts?.filter((p) => p.type === "text").map((p) => p.text).join("") ?? ""

  // 1. persist the user message
  const messageId = await persistMessage({
    sessionId, userId, role: "user", content: draft,
  })

  // 2. retrieve against the PREVIOUS graph state, then call the model
  let chats: Awaited<ReturnType<typeof retrieveContext>>["chats"] = []
  try {
    ;({ chats } = await retrieveContext({ userId, sessionId, mode, taggedChatIds, draftText: draft }))
  } catch (err) {
    // Spec §6.5 — never block the message. Memory is the feature; the answer is
    // the product. Degrade to no memory rather than failing the request.
    console.error("[chat] retrieval failed, continuing without memory", err)
  }

  const memory = chats
    .map((c) => `## ${c.title}  (${c.why})\n${c.compaction.split(RECORD_SEPARATOR).join("\n")}`)
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
      try {
        await persistMessage({
          sessionId, userId, role: "assistant", content: text, modelUsed: modelId,
        })
        await ingestUserMessage({
          sessionId, userId, messageId, content: draft,
          // Compaction takes both roles (spec §4.1); extraction stays
          // user-only (spec §4.2). ingestUserMessage enforces that split.
          assistantContent: text,
        })
      } catch (err) {
        // Spec §4.5 — the write path runs after the stream, so a failure here must
        // never break the answer the user already received. But it must not vanish
        // either: an unlogged failure means memory is silently lost.
        console.error("[chat] graph write failed after stream", err)
      }
    },
  })

  return result.toUIMessageStreamResponse()
}
