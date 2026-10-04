import { randomUUID } from "node:crypto"
import { streamText, convertToModelMessages, type UIMessage } from "ai"
import { resolveChatModel } from "@/server/model"
import { retrieveContext } from "@/services/retrieval"
import { persistMessage, finishTurn } from "@/services/graph"
import { isUuidV4 } from "@/lib/workspace"
import { sessionExists } from "@/services/dbApi"
import { buildSystemPrompt, buildCoreBlock } from "@/lib/prompt"
import { requireWorkspace } from "@/server/workspace"
import { describeSkip } from "@/lib/pointers"
import { getCore } from "@/services/core"
import { PROVISIONAL } from "@/lib/provisional"
import { stripVisualize, visualizePrefixLength, wantsDiagram } from "@/lib/scene/intent"
import { DIAGRAM_GUIDE } from "@/lib/scene/guide"

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

  const resolved = await resolveChatModel(model)
  if (!resolved.ok) return Response.json({ error: resolved.error }, { status: resolved.status })
  const { modelId } = resolved

  const last = messages[messages.length - 1]
  if (!last || last.role !== "user") {
    return Response.json({ error: "last message must be a user message" }, { status: 400 })
  }
  const draft = last?.parts?.filter((p) => p.type === "text").map((p) => p.text).join("") ?? ""

  // Spec §3: what memory reads. `/visualize` is a command, not a concept; the
  // stored message keeps exactly what was typed.
  const memoryDraft = stripVisualize(draft)

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

  // 1. persist the user message, under the id the browser already shows
  // (message-actions ticket 01), so a delete can name it without a reload.
  const messageId = await persistMessage({
    workspaceId, sessionId, role: "user", content: draft, id: isUuidV4(last.id) ? last.id : undefined,
  })

  // 2. retrieve against the PREVIOUS graph state, then call the model
  let chats: Awaited<ReturnType<typeof retrieveContext>>["chats"] = []
  try {
    ;({ chats } = await retrieveContext({ workspaceId, sessionId, mode, taggedChatIds, draftText: memoryDraft }))
  } catch (err) {
    // Spec §6.5 — never block the message. Memory is the feature; the answer is
    // the product. Degrade to no memory rather than failing the request.
    console.error("[chat] retrieval failed, continuing without memory", err)
  }

  // Ticket 03: Core reaches the model through its own slot, never through
  // retrieval — so focus mode skipping retrieval does not skip Core.
  let core: string | undefined
  if (PROVISIONAL.coreInModes[mode]) {
    try { core = buildCoreBlock((await getCore(workspaceId)).text) }
    catch (err) { console.error('[chat] could not read About you, continuing without it', err) }
  }
  const systemPrompt = buildSystemPrompt(mode, chats, {
    core,
    diagrams: wantsDiagram(draft) ? DIAGRAM_GUIDE : undefined,
  })
  // Chosen here so the browser and the database agree on the reply's id:
  // the diagram player names this message when it asks for a repair.
  const assistantMessageId = randomUUID()

  const result = streamText({
    model: resolved.model,
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
        // Pointers are offsets into the STORED row (`draft`), not the
        // command-stripped `memoryDraft` extraction reads — those two
        // differ in length for a `/visualize ...` message by exactly the
        // length of the command `stripVisualize` removed. Pointers are
        // built from the clean `memoryDraft` (so `match_text` never
        // contains "/visualize"), then shifted back onto `draft`'s offsets.
        const done = await finishTurn({
          workspaceId, sessionId, messageId, memoryDraft, text, modelId, assistantMessageId,
          pointerShift: visualizePrefixLength(draft),
        })
        if (!done) {
          console.warn(`[chat] reply not saved: its question ${messageId} was deleted while it streamed`)
          return
        }
        // Ticket 05, Q14 — a block too large to index is a loss, and a loss
        // is never silent. Logged only: one block, not the whole message.
        for (const s of done.skipped) console.warn(`[chat] ${describeSkip(sessionId, s.messageId, s)}`)
      } catch (err) {
        // Spec §4.5 — the write path runs after the stream, so a failure here must
        // never break the answer the user already received. But it must not vanish
        // either: an unlogged failure means memory is silently lost.
        console.error("[chat] graph write failed after stream", err)
      }
    },
  })

  return result.toUIMessageStreamResponse({ onError: explainStreamFailure, generateMessageId: () => assistantMessageId })
}
