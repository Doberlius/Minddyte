import { forgetConcept, forgetPreview } from "@/services/forget"
import { requireWorkspace } from "@/server/workspace"

const NOT_FOUND = () => Response.json({ error: "not_found" }, { status: 404 })

/** What forgetting `?key=` in this chat would hide. Ticket 10, Q11/Q17. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const key = new URL(request.url).searchParams.get("key") ?? ""
  if (!key) return Response.json({ error: "a key is required" }, { status: 400 })
  const preview = await forgetPreview(await requireWorkspace(), id, key)
  return preview ? Response.json(preview) : NOT_FOUND()
}

/** Forget `{ key }` in this chat. 404 when the chat does not hold it (Q12: there is no undo). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  let body: { key?: unknown }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: "expected a JSON body with a key" }, { status: 400 })
  }
  if (typeof body.key !== "string" || !body.key) return Response.json({ error: "a key is required" }, { status: 400 })
  return (await forgetConcept(await requireWorkspace(), id, body.key)) ? new Response(null, { status: 204 }) : NOT_FOUND()
}
