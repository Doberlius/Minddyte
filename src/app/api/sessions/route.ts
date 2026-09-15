import { listChats } from "@/services/dbApi"

export async function GET() {
  return Response.json(await listChats())
}
