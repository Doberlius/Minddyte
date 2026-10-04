import { deleteTurn } from "@/services/turns"
import { requireWorkspace } from "@/server/workspace"
import { isUuidV4 } from "@/lib/workspace"

const NOT_FOUND = () => Response.json({ error: "not_found" }, { status: 404 })

/**
 * Delete the turn holding this message: the message and its reply, from the
 * chat and from memory (message-actions ticket 01). There is no undo; the
 * dialog asked first (Q11).
 *
 * Both ids are checked before anything else: one that is not a uuid would make
 * Postgres throw (a 500), and no such message can exist, so it gets the same
 * 404 as a message that does not — or one in a chat that is not yours.
 */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string; messageId: string }> }) {
  const { id, messageId } = await params
  if (!isUuidV4(id) || !isUuidV4(messageId)) return NOT_FOUND()
  const deleted = await deleteTurn(await requireWorkspace(), id, messageId)
  return deleted ? Response.json({ deleted }) : NOT_FOUND()
}
