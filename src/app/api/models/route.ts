import { listModels, API_BASE } from "@/lib/ollama"
import { chooseProvider, hostedModels } from "@/lib/provider"
import type { ModelEntry } from "@/types"

/**
 * What this deployment can actually offer. Shaped as ModelEntry so the picker
 * does not have to know Ollama's wire format — and empty, never an error,
 * when the daemon is unreachable: a missing model list must not break the
 * page.
 *
 * The hosted path returns the deployment's own allow-list rather than asking
 * an upstream service what it has, and never touches the daemon at all —
 * `chooseProvider` already decided that a key means no localhost fallback.
 */
export async function GET() {
  const choice = chooseProvider(process.env)

  if (choice.kind === 'hosted') {
    // A deployment offers what it is willing to pay for, not whatever the
    // upstream service happens to host. Marked `cloud` because the picker
    // filters on that and these genuinely run elsewhere.
    const models: ModelEntry[] = hostedModels(process.env).map((m) => ({
      id: m.id,
      label: m.label,
      location: 'cloud',
      // `size` and `downloaded` are documented in ModelEntry as meaningful
      // only when location === 'local', so they are left off here.
    }))
    return Response.json(models)
  }

  return Response.json(await listModels())
}

export async function DELETE(req: Request) {
  const { model } = await req.json()
  const res = await fetch(`${API_BASE}/delete`, {
    method: "DELETE",
    body: JSON.stringify({ name: model }),
  })
  if (!res.ok) {
    return Response.json({ error: `Ollama refused to delete ${model}` }, { status: 502 })
  }
  // The cached list in listModels() is now stale; its 30s TTL clears it.
  return Response.json({ success: true })
}
