import { streamText, convertToModelMessages, type UIMessage } from "ai"
import { clientFor, resolveModel } from "@/lib/ollama"
import { chooseProvider } from "@/lib/provider"
import { retrieveContext } from "@/services/retrieval"
import { persistMessage, ingestUserMessage } from "@/services/graph"
import { sessionExists } from "@/services/dbApi"
import { buildSystemPrompt } from "@/lib/prompt"
import { requireWorkspace } from "@/server/workspace"

/**
 * A runaway guard, NOT a budget.
 *
 * It was 2048, which is roughly half of what this model writes unprompted —
 * so it did not shorten answers, it truncated them. Measured: a question
 * about Postgres indexing stopped mid-table with finishReason 'length',
 * which in a demo reads as the app breaking rather than as a limit being
 * reached. A cap cannot make a model concise; the model does not know the
 * cap exists, so it plans a long answer and gets cut off. Only the prompt
 * can do that, and the decision here is deliberately to let answers run.
 *
 * 16384 because the most sprawling question I could construct — "explain the
 * entire query planner, with examples for every join strategy" — finished on
 * its own at 7,381 tokens. Half that again is headroom; anything past it is
 * a model looping, not a model answering.
 *
 * Named because it has to be passed twice, in two different dialects, and a
 * pair of bare numbers that must agree is a pair that eventually will not.
 */
const MAX_OUTPUT_TOKENS = 16384

/**
 * What to tell the browser when the model call fails mid-stream.
 *
 * Once the stream has started the status line is already 200, so a failure
 * after that point arrives as an `error` part inside the stream rather than
 * as an HTTP error — which means `classifyChatFailure` on the client never
 * sees it. The SDK's default fills that part with `error.message`, and for a
 * 400 that string is "Bad Request": true, and useless to the person who just
 * pasted something.
 *
 * The provider already said exactly what it objected to, in the response
 * body. Measured against a 824,000-character paste, it answers:
 *
 *   The prompt is too long: 287145, model maximum context length: 131072
 *
 * So this forwards that sentence. ONLY the `error` field of a JSON body is
 * forwarded, never `error.message` or the raw text — a bounded field cannot
 * carry a stack trace, an internal URL or anything else this has no business
 * showing a visitor. Anything unrecognised becomes the generic sentence, and
 * the full error is on the server log either way.
 */
function explainStreamFailure(error: unknown): string {
  const GENERIC =
    'The model could not finish answering. Your text is still in the box — try again.'

  const body = (error as { responseBody?: unknown } | null)?.responseBody
  if (typeof body !== 'string') return GENERIC

  let said: unknown
  try {
    said = (JSON.parse(body) as { error?: unknown }).error
  } catch {
    return GENERIC
  }
  if (typeof said !== 'string' || !said.trim()) return GENERIC

  // The trailing "(ref: …)" is the provider's trace id. It belongs in the
  // server log, which already has it, not in a sentence someone reads.
  const sentence = said.replace(/\s*\(ref:[^)]*\)\s*$/, '').trim()

  // Counted in tokens, which nobody types in. Saying so turns a number the
  // visitor cannot act on into an instruction they can.
  if (/prompt is too long/i.test(sentence)) {
    return `${sentence}. Those are tokens, not characters — roughly four characters each. Send a shorter piece of it.`
  }
  return sentence
}

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
    ;({ chats } = await retrieveContext({ workspaceId, sessionId, mode, taggedChatIds, draftText: draft }))
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
    // maxOutputTokens alone does NOT reach ollama.com/api. The provider maps
    // it to `max_tokens`, the OpenAI-compatible field; this endpoint is
    // Ollama's native one and reads `num_predict` out of `options` instead,
    // so the standardized setting was sent and silently ignored on every
    // request. Both are kept — maxOutputTokens is what a local daemon and any
    // future OpenAI-shaped provider read, num_predict is what this one reads.
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    providerOptions: { ollama: { options: { num_predict: MAX_OUTPUT_TOKENS } } },
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

  return result.toUIMessageStreamResponse({ onError: explainStreamFailure })
}
