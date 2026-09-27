import { generateText } from 'ai'
import { parseRepairBody, repairPrompt, REPAIR_SYSTEM } from '@/lib/scene/repair'
import { extractSceneCode, isSingleSceneBody } from '@/lib/scene/blocks'
import { loadSceneBlock, saveSceneBlock } from '@/services/scene'
import { requireWorkspace } from '@/server/workspace'
import { resolveChatModel } from '@/server/model'

const MAX_REPAIR_TOKENS = 4000

/**
 * Spec §8. Repairs one scene block of the caller's own reply with the chat's
 * model, or saves a repair that ran. The body is validated before the
 * workspace cookie is read, and the code to repair is always read from the
 * database, so this is never a free model endpoint.
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
