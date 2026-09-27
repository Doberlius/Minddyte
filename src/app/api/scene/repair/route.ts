import { generateText } from 'ai'
import { createRepairBudget, parseRepairBody, repairPrompt, REPAIR_SYSTEM } from '@/lib/scene/repair'
import { extractSceneCode, isSingleSceneBody } from '@/lib/scene/blocks'
import { loadSceneBlock, saveSceneBlock } from '@/services/scene'
import { requireWorkspace } from '@/server/workspace'
import { resolveChatModel } from '@/server/model'

const MAX_REPAIR_TOKENS = 4000

/**
 * How many repair (non-save) calls one block gets, and how many blocks this
 * process remembers counts for at once. Module-level and in-memory on
 * purpose: this only has to survive one server process's uptime, not a
 * restart, and per-process is exactly the unit a script looping this
 * endpoint would be hitting.
 */
const MAX_REPAIR_CALLS_PER_BLOCK = 5
const MAX_BUDGET_KEYS = 1000
const repairBudget = createRepairBudget(MAX_REPAIR_CALLS_PER_BLOCK, MAX_BUDGET_KEYS)

/**
 * Spec §8. Repairs one scene block of the caller's own reply with the chat's
 * model, or saves a repair that ran. The body is validated before the
 * workspace cookie is read, exactly as the forget route does.
 *
 * This is not walled off from the model the way, say, a pure data endpoint
 * would be: the failing code always comes from the caller's own stored
 * reply (never trusted from the request), but `error` and an earlier failed
 * `previous` attempt are attacker-influenced text that does reach the
 * model's prompt. That is the same shape of exposure `/api/chat` already
 * has — a visitor's own words reaching a model call — and that route is
 * unmetered too; this product deliberately has no general rate limit. What
 * this endpoint adds instead is a limit scoped to what is actually at risk:
 * `repairBudget` below caps repair calls to `MAX_REPAIR_CALLS_PER_BLOCK` per
 * `messageId:blockIndex`, so a script cannot turn one diagram into an
 * unbounded stream of model calls even without a site-wide limiter.
 */
export async function POST(req: Request) {
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return Response.json({ error: 'bad_request' }, { status: 400 })
  }
  const body = parseRepairBody(raw)
  if (!body) return Response.json({ error: 'bad_request' }, { status: 400 })

  const workspaceId = await requireWorkspace()
  const target = { workspaceId, sessionId: body.sessionId, messageId: body.messageId, blockIndex: body.blockIndex }

  if (body.save) {
    const saved = await saveSceneBlock({ ...target, code: body.code })
    return saved ? Response.json({ saved: true }) : Response.json({ error: 'not_found' }, { status: 404 })
  }

  const code = await loadSceneBlock(target)
  if (code === null) return Response.json({ error: 'not_found' }, { status: 404 })

  // Counted only once ownership is proven: a stranger probing ids spends
  // their own attempts' worth of 404s, never another chat's budget.
  if (!repairBudget.take(`${body.messageId}:${body.blockIndex}`)) {
    return Response.json({ error: 'repair_limit' }, { status: 429 })
  }

  const resolved = await resolveChatModel(body.model)
  if (!resolved.ok) return Response.json({ error: resolved.error }, { status: resolved.status })

  try {
    const { text } = await generateText({
      model: resolved.model,
      system: REPAIR_SYSTEM,
      prompt: repairPrompt({ code, error: body.error, previous: body.previous }),
      maxOutputTokens: MAX_REPAIR_TOKENS,
      providerOptions: { ollama: { options: { num_predict: MAX_REPAIR_TOKENS } } },
    })
    const fixed = extractSceneCode(text)
    if (!fixed || !isSingleSceneBody(fixed)) return Response.json({ error: 'no_block' }, { status: 502 })
    return Response.json({ code: fixed })
  } catch (err) {
    console.error('[scene] repair failed', err)
    return Response.json({ error: 'model_failed' }, { status: 502 })
  }
}
