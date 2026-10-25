import { loadGraph } from "@/services/dbApi"
import { requireWorkspace } from "@/server/workspace"

/**
 * Everything the Brain draws, in one request: the map of which conversations
 * share a concept, and for each conversation how much of it is saved for
 * memory (the panel beside a selected card). Splitting them would mean two
 * round trips for one picture.
 */
export async function GET() {
  return Response.json(await loadGraph(await requireWorkspace()))
}
