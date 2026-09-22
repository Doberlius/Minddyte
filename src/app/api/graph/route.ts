import { loadGraph } from "@/services/dbApi"

/**
 * Everything the Brain and the Archive draw, in one request.
 *
 * One route for both because they are two readings of the same graph: the
 * canvas shows which conversations share a concept, and the archive shows the
 * memory each of those conversations would hand over. Splitting them would
 * mean two round trips for one picture.
 */
export async function GET() {
  return Response.json(await loadGraph())
}
