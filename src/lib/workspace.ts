import { randomUUID } from 'node:crypto'

/**
 * Everything about a workspace's identity that does not need a request.
 *
 * Kept apart from the cookie handling so it can be tested without one, and
 * so the name and lifetime have exactly one definition — a reader and a
 * writer that disagree about a cookie's name produce a new workspace on
 * every request, which looks like data loss and is very hard to see.
 */

export const WORKSPACE_COOKIE = 'minddyte_ws'

/** Spec §1. Clearing cookies before this elapses means starting over. */
export const COOKIE_MAX_AGE = 30 * 24 * 60 * 60

/**
 * Not signed, and deliberately so: the id IS the secret, and a random v4
 * uuid cannot be guessed. A signature would prove the server minted it,
 * which buys nothing once an unguessable value is already required. Spec §1
 * records this as considered rather than forgotten.
 */
export function newWorkspaceId(): string {
  return randomUUID()
}

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/**
 * A cookie is client-controlled, so what arrives is a claim, not a fact.
 * Validating here means no unchecked string ever reaches a WHERE clause,
 * and an altered cookie gets a fresh empty workspace rather than an error
 * that leaks whether some other value would have worked.
 */
export function isWorkspaceId(value: unknown): value is string {
  return typeof value === 'string' && V4.test(value)
}
