import { streamText, convertToModelMessages, type UIMessage } from "ai"
import { clientFor, resolveModel } from "@/lib/ollama"
import { chooseProvider } from "@/lib/provider"
import { retrieveContext } from "@/services/retrieval"
import { persistMessage, ingestUserMessage } from "@/services/graph"
import { sessionExists } from "@/services/dbApi"
import { buildSystemPrompt } from "@/lib/prompt"
import { requireWorkspace } from "@/server/workspace"
import { MAX_REQUESTS, checkMessage, memoryBudget } from "@/lib/rate-limit"
import { charge, clientKey, limitHeaders, peek } from "@/server/rate-limit"

export async function POST(req: Request) {
  // Read once, pass the same value everywhere below. sessionExists,
  // retrieveContext, persistMessage and ingestUserMessage all need it;
  // calling requireWorkspace() again for each would still work today, but it
  // invites a future edit where two of those calls read the cookie at
  // different moments and disagree.
  const workspaceId = await requireWorkspace()

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

  // Length first, then the rate limit, then the charge — in that order, and
  // all of it before anything touches the database. A message refused for
  // being too long must not also cost a slot: the visitor is about to shorten
  // it and send again, and charging them twice for one message is how a
  // budget guard turns into a punishment.
  const length = checkMessage(draft)
  if (!length.ok) {
    return Response.json({ error: "message_too_long", message: length.reason }, { status: 413 })
  }

  const key = clientKey(req)
  const budget = peek(key)
  if (!budget.allowed) {
    const seconds = Math.ceil(budget.resetInMs / 1000)
    return Response.json(
      {
        error: "rate_limited",
        // Standing rule: name the problem AND the recovery. The recovery here
        // is a wait, so it has to be a number — "try again later" leaves
        // someone refreshing a page that will refuse them for another minute.
        message:
          `That is ${MAX_REQUESTS} messages this minute, which is all this demo allows. ` +
          `The next one opens in ${seconds}s. Nothing was lost — send it again then. ` +
          'The /demo page runs the same graph with no model behind it, and has no limit.',
        retryAfterSeconds: seconds,
      },
      { status: 429, headers: { ...limitHeaders(budget), "Retry-After": String(seconds) } },
    )
  }
  charge(key)

  // A browser can hold a sessionId for a chat the database no longer has —
  // db:reset, a deleted chat, a restored export all look identical from here.
  // Checked BEFORE persistMessage runs: messages.session_id is a NOT NULL FK
  // into sessions, so without this check the insert below throws a foreign-key
  // violation that nothing catches — every future message for this browser
  // would 500 forever, with no way back short of manually clearing site data.
  // "session_not_found" is a machine-readable marker (not just the status
  // code) so the client can tell this apart from every OTHER way a chat
  // request can fail, and react specifically: forget the id, start a new chat.
  if (!(await sessionExists(workspaceId, sessionId))) {
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
    workspaceId, sessionId, role: "user", content: draft,
  })

  // 2. retrieve against the PREVIOUS graph state, then call the model
  let chats: Awaited<ReturnType<typeof retrieveContext>>["chats"] = []
  try {
    // Memory gets whatever the message did not spend. The request cap trims
    // rather than refuses, because the memory is the app's choice, not the
    // visitor's — refusing there would punish someone for having a rich
    // graph, which is the thing the product is for.
    ;({ chats } = await retrieveContext({
      workspaceId, sessionId, mode, taggedChatIds, draftText: draft,
      budgetChars: memoryBudget(draft.length),
    }))
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
          workspaceId, sessionId, role: "assistant", content: text, modelUsed: modelId,
        })
        await ingestUserMessage({
          workspaceId, sessionId, messageId, content: draft,
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
