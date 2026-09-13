import { listChats } from "@/services/dbApi"

export async function GET(req: Request) {
  const userId = new URL(req.url).searchParams.get("userId")
  if (!userId) return Response.json({ error: "userId required" }, { status: 400 })
  return Response.json(await listChats(userId))
}
