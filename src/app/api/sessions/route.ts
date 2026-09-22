import { createChat, listChats } from "@/services/dbApi"
import { requireWorkspace } from "@/server/workspace"

export async function GET() {
  return Response.json(await listChats(await requireWorkspace()))
}

// No body. The client needs the id back immediately, because the very next
// thing it does is send the message that caused the chat to exist.
export async function POST() {
  return Response.json(await createChat(await requireWorkspace()))
}
