import { createChat, listChats } from "@/services/dbApi"

export async function GET() {
  return Response.json(await listChats())
}

// No body. The client needs the id back immediately, because the very next
// thing it does is send the message that caused the chat to exist.
export async function POST() {
  return Response.json(await createChat())
}
