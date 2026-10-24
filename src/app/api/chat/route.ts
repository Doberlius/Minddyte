import { handleChat } from "@/server/chat"
import { requireWorkspace } from "@/server/workspace"

/**
 * POST /api/chat. The workspace cookie is read here, once, and everything
 * else lives in `handleChat` (src/server/chat.ts): a route file may export
 * only route handlers, and that one can be tested without a request scope.
 */
export async function POST(req: Request) {
  return handleChat(req, await requireWorkspace())
}
