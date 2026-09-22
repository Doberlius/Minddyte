import { listModels, API_BASE } from "@/lib/ollama"

/**
 * What this machine can actually run. Shaped as ModelEntry so the picker does
 * not have to know Ollama's wire format — and empty, never an error, when the
 * daemon is unreachable: a missing model list must not break the page.
 */
export async function GET() {
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
