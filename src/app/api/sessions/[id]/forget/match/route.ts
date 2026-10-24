import { conceptsMentioned } from "@/services/forget"
import { requireWorkspace } from "@/server/workspace"
import { isUuidV4 } from "@/lib/workspace"

const NOT_FOUND = () => Response.json({ error: "not_found" }, { status: 404 })

/** The longest highlight the selection chip may send. */
const MAX_TEXT = 4000

/**
 * Which of this chat's concepts the highlighted `{ text }` mentions (Q26), for
 * the selection chip's Forget button. The id is checked first, as in the
 * forget route: a non-uuid would make Postgres throw (a 500). A chat that is
 * not this workspace's gets the same 404 as one that does not exist.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!isUuidV4(id)) return NOT_FOUND()
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: "expected a JSON body with text" }, { status: 400 })
  }
  const text = typeof body === "object" && body !== null ? (body as { text?: unknown }).text : undefined
  if (typeof text !== "string" || text.length > MAX_TEXT) {
    return Response.json({ error: `text must be a string of at most ${MAX_TEXT} characters` }, { status: 400 })
  }
  const concepts = await conceptsMentioned(await requireWorkspace(), id, text)
  return concepts ? Response.json({ concepts }) : NOT_FOUND()
}
