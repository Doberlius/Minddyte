import { streamText, convertToModelMessages, type UIMessage } from "ai"
import { ollama, resolveModel } from "@/lib/ollama"
import { retrieveContext } from "@/services/retrieval"
import { persistMessage, ingestUserMessage } from "@/services/graph"
import { buildSystemPrompt } from "@/lib/prompt"

export async function POST(req: Request) {
  const {
    messages, sessionId, taggedChatIds = [], mode = "explore", model,
  }: {
    messages: UIMessage[]
    sessionId: string
    taggedChatIds?: string[]
    mode?: "focus" | "explore"
    model?: string
  } = await req.json()

  // Validated against what the daemon actually reports, not a hardcoded list.
  const modelId = await resolveModel(model)
  if (!modelId) {
    // Standing rule: say what is wrong and how to fix it, never fail blankly.
    return Response.json(
      {
        error:
          "No model available. Start Ollama, then pull one with `ollama pull gemma3` " +
          "— or run `ollama signin` to use cloud models.",
      },
      { status: 503 },
    )
  }

  const last = messages[messages.length - 1]
  if (!last || last.role !== "user") {
    return Response.json({ error: "last message must be a user message" }, { status: 400 })
  }
  const draft = last?.parts?.filter((p) => p.type === "text").map((p) => p.text).join("") ?? ""

  // 1. persist the user message
  const messageId = await persistMessage({
    sessionId, role: "user", content: draft,
  })

  // 2. retrieve against the PREVIOUS graph state, then call the model
  let chats: Awaited<ReturnType<typeof retrieveContext>>["chats"] = []
  try {
    ;({ chats } = await retrieveContext({ sessionId, mode, taggedChatIds, draftText: draft }))
  } catch (err) {
    // Spec §6.5 — never block the message. Memory is the feature; the answer is
    // the product. Degrade to no memory rather than failing the request.
    console.error("[chat] retrieval failed, continuing without memory", err)
  }

  const systemPrompt = buildSystemPrompt(mode, chats)

  const result = streamText({
    model: ollama(modelId),
    system: systemPrompt,
    messages: await convertToModelMessages(messages),
    maxOutputTokens: 2048,
    // 3-6. Graph writes happen AFTER the stream. Spec §4.5.
    onFinish: async ({ text }) => {
      try {
        await persistMessage({
          sessionId, role: "assistant", content: text, modelUsed: modelId,
        })
        await ingestUserMessage({
          sessionId, messageId, content: draft,
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
