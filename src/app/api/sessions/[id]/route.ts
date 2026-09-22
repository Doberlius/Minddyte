import { deleteChat, loadChat, renameChat, TITLE_CAP } from "@/services/dbApi"

/**
 * One chat, with its messages.
 *
 * `loadChat` has existed in dbApi since the beginning and nothing ever
 * exposed it: the client only had the list endpoint, so a chat's messages
 * lived in `useChat`'s memory and nowhere a second visit could reach them.
 * That was survivable while a single chat was pinned by an env var. The
 * moment the sidebar lets you click a different one, a chat you cannot open
 * is a chat that looks deleted.
 *
 * 404 carries the same `session_not_found` marker POST /api/chat uses, so the
 * client has one shape to recognise for "the chat this browser remembers is
 * gone" rather than two.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const chat = await loadChat(id)

  if (!chat) {
    return Response.json({ error: "session_not_found" }, { status: 404 })
  }

  return Response.json(chat)
}

/**
 * Delete one chat.
 *
 * 404 rather than 204 when there was nothing to delete, because the client
 * uses the same `session_not_found` marker to recognise "the chat this browser
 * remembers is gone" — a delete that silently succeeds on a stale id would
 * hide that from it.
 *
 * `deleteChat` also repairs `nodes.chat_count`, which no foreign key can.
 */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  if (!(await deleteChat(id))) {
    return Response.json({ error: "session_not_found" }, { status: 404 })
  }

  return new Response(null, { status: 204 })
}

/**
 * Rename one chat.
 *
 * The only field a client may set. A title is derived once from the first
 * message and never recomputed, so this is the user's override of that — see
 * `renameChat`, which also rejects a name that is only whitespace.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  let body: { title?: unknown }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: "expected a JSON body with a title" }, { status: 400 })
  }

  if (typeof body.title !== "string" || !body.title.trim()) {
    return Response.json(
      { error: "A name is required.", message: `Up to ${TITLE_CAP} characters.` },
      { status: 400 },
    )
  }

  if (!(await renameChat(id, body.title))) {
    return Response.json({ error: "session_not_found" }, { status: 404 })
  }

  return new Response(null, { status: 204 })
}
