import { PartsChangedError, forgetConcept, forgetPreview } from "@/services/forget"
import { requireWorkspace } from "@/server/workspace"
import { isUuidV4 } from "@/lib/workspace"

const NOT_FOUND = () => Response.json({ error: "not_found" }, { status: 404 })

// Both handlers check the chat id first: it comes from the URL, and one that
// is not a uuid would make Postgres throw (a 500). No such chat can exist,
// so it gets the same 404 as a chat that does not.

/** What forgetting `?key=` in this chat would hide. Ticket 10, Q11/Q17. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!isUuidV4(id)) return NOT_FOUND()
  const key = new URL(request.url).searchParams.get("key") ?? ""
  if (!key) return Response.json({ error: "a key is required" }, { status: 400 })
  const preview = await forgetPreview(await requireWorkspace(), id, key)
  return preview ? Response.json(preview) : NOT_FOUND()
}

/**
 * Forget `{ key, parts? }` in this chat. 404 when the chat does not hold it
 * (Q12: there is no undo). 409 `parts_changed` when a ticked part may no
 * longer be ticked (it became a concept, or a word of one, since the modal
 * opened); nothing was forgotten, and the modal reads the chat again.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!isUuidV4(id)) return NOT_FOUND()
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: "expected a JSON body with a key" }, { status: 400 })
  }
  // Valid JSON is not always an object: a body of `null` (or `3`, or `"x"`)
  // parses fine, and reading `.key` off null would throw and answer 500.
  const key = typeof body === "object" && body !== null ? (body as { key?: unknown }).key : undefined
  if (typeof key !== "string" || !key) return Response.json({ error: "a key is required" }, { status: 400 })
  // Ticket 10, F9–F12: the ticked parts of the name. Optional; a list of at
  // most 20 words of at most 100 characters. Words the name does not contain
  // are ignored by forgetConcept.
  const parts = typeof body === "object" && body !== null ? (body as { parts?: unknown }).parts : undefined
  if (
    parts !== undefined &&
    !(Array.isArray(parts) && parts.length <= 20 && parts.every((p) => typeof p === "string" && p.length <= 100))
  ) {
    return Response.json({ error: "parts must be a list of words" }, { status: 400 })
  }
  try {
    const ok = await forgetConcept(await requireWorkspace(), id, key, (parts as string[] | undefined) ?? [])
    return ok ? new Response(null, { status: 204 }) : NOT_FOUND()
  } catch (error) {
    if (error instanceof PartsChangedError) return Response.json({ error: "parts_changed" }, { status: 409 })
    throw error
  }
}
