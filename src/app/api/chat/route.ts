import { streamText, convertToModelMessages, type UIMessage } from "ai"
import { clientFor, resolveModel } from "@/lib/ollama"
import { chooseProvider } from "@/lib/provider"
import { retrieveContext } from "@/services/retrieval"
import { persistMessage, ingestUserMessage } from "@/services/graph"
import { sessionExists } from "@/services/dbApi"
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

  const choice = chooseProvider(process.env, model)

  if (choice.kind === "none") {
    // Standing rule: say what is wrong and how to fix it, never fail blankly.
    return Response.json({ error: choice.reason }, { status: 503 })
  }

  // The hosted path already knows its model; only the local daemon has to be
  // asked what it actually has. Validated against what the daemon actually
  // reports, not a hardcoded list.
  const modelId =
    choice.kind === "hosted" ? choice.model : await resolveModel(choice.model)

  if (!modelId) {
    // Standing rule: say what is wrong and how to fix it, never fail blankly.
    return Response.json(
      {
        error:
          "No model available. Start Ollama and pull one with `ollama pull gemma3`, " +
          "or set HOSTED_API_KEY to use a hosted model instead.",
      },
      { status: 503 },
    )
  }

  const last = messages[messages.length - 1]
  if (!last || last.role !== "user") {
    return Response.json({ error: "last message must be a user message" }, { status: 400 })
  }
  const draft = last?.parts?.filter((p) => p.type === "text").map((p) => p.text).join("") ?? ""

  // A browser can hold a sessionId for a chat the database no longer has —
  // db:reset, a deleted chat, a restored export all look identical from here.
  // Checked BEFORE persistMessage runs: messages.session_id is a NOT NULL FK
  // into sessions, so without this check the insert below throws a foreign-key
  // violation that nothing catches — every future message for this browser
  // would 500 forever, with no way back short of manually clearing site data.
  // "session_not_found" is a machine-readable marker (not just the status
  // code) so the client can tell this apart from every OTHER way a chat
  // request can fail, and react specifically: forget the id, start a new chat.
  if (!(await sessionExists(sessionId))) {
    return Response.json(
      {
        error: "session_not_found",
        message: "This chat no longer exists. Starting a new one will fix it.",
      },
      { status: 404 },
    )
  }

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
    model: clientFor(choice)(modelId),
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
