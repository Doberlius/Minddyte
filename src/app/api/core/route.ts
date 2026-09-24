import { getCore, saveCore, CoreTooLongError } from "@/services/core"
import { requireWorkspace } from "@/server/workspace"

export async function GET() {
  return Response.json(await getCore(await requireWorkspace()))
}

export async function PUT(request: Request) {
  let body: { text?: unknown }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Send the text as { "text": "..." }.' }, { status: 400 })
  }

  if (typeof body.text !== "string") {
    return Response.json({ error: 'Send the text as { "text": "..." }.' }, { status: 400 })
  }

  try {
    return Response.json(await saveCore(await requireWorkspace(), body.text))
  } catch (err) {
    if (err instanceof CoreTooLongError) {
      return Response.json({ error: err.message }, { status: 400 })
    }
    throw err
  }
}
