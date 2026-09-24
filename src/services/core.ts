import { getDb, userCore } from "../../db"
import { eq } from "drizzle-orm"
import { validateCore } from "@/lib/core"

/**
 * Thrown by `saveCore` when the text is over the cap. Carries the same plain
 * message `validateCore` produced, so a caller (the API route) can hand it
 * straight to the person without re-deriving it.
 */
export class CoreTooLongError extends Error {}

/**
 * The "About you" text for a workspace, ticket 03. No row yet reads as
 * empty text and no timestamp — Core has never been saved, not "saved as
 * blank".
 */
export async function getCore(workspaceId: string): Promise<{ text: string; updatedAt: Date | null }> {
  const db = await getDb()
  const [row] = await db
    .select({ text: userCore.text, updatedAt: userCore.updatedAt })
    .from(userCore)
    .where(eq(userCore.workspaceId, workspaceId))
  return row ?? { text: "", updatedAt: null }
}

/**
 * Writes the workspace's Core, hand-only. Standing rule: never destroy what
 * someone typed — over-long text is validated BEFORE anything is written, so
 * a rejected save throws and leaves the previous row untouched.
 */
export async function saveCore(workspaceId: string, text: string): Promise<{ text: string; updatedAt: Date }> {
  const check = validateCore(text)
  if (!check.ok) throw new CoreTooLongError(check.message)

  const db = await getDb()
  const updatedAt = new Date()
  const [row] = await db
    .insert(userCore)
    .values({ workspaceId, text, updatedAt })
    .onConflictDoUpdate({
      target: userCore.workspaceId,
      set: { text, updatedAt },
    })
    .returning({ text: userCore.text, updatedAt: userCore.updatedAt })
  return row
}
