import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { hostname } from 'node:os'
import path from 'node:path'

/**
 * How often a live instance rewrites its timestamp, and how long the record
 * may go untouched before another instance may take the directory.
 *
 * STALE_MS is deliberately several heartbeats wide. A lease that expired
 * after one missed beat would evict a perfectly healthy instance that merely
 * lost a scheduler slot — and evicting a healthy instance is the exact
 * outcome this whole file exists to prevent.
 *
 * The cost of the width is recovery time: after a hard kill (SIGKILL, OOM)
 * nothing releases the lock, so the replacement waits out the lease. A clean
 * shutdown releases it and waits for nothing.
 */
export const HEARTBEAT_MS = 5_000
export const STALE_MS = 30_000

/** What is on disk. `at` is epoch milliseconds — the holder's last check-in. */
export type LockRecord = {
  holder: string
  pid: number
  host: string
  at: number
}

export type Identity = Pick<LockRecord, 'holder' | 'pid' | 'host'>

/**
 * This process's identity, fixed for its lifetime.
 *
 * `holder` is a fresh uuid rather than the pid, because a pid does not
 * identify anything outside its own namespace: restart a container and the
 * next process is pid 1 again, on a host where pid 1 already means something
 * else. A uuid is the same value nowhere else, ever.
 */
const SELF: Identity = { holder: randomUUID(), pid: process.pid, host: hostname() }

export function self(): Readonly<Identity> {
  return SELF
}

/**
 * Thrown when another LIVE instance already has the data directory open.
 *
 * It carries the pid because the standing rule is to explain rather than to
 * fail blankly — but the pid is only meaningful when the holder is on this
 * machine, so the message it builds differs by case.
 */
export class DataDirLockedError extends Error {
  constructor(
    readonly pid: number,
    readonly lockPath: string,
    message: string,
  ) {
    super(message)
    this.name = 'DataDirLockedError'
  }
}

function sameMachineMessage(pid: number, lockPath: string): string {
  return (
    `Minddyte's database is already open in process ${pid}.\n` +
    'Close that process first — but only if it really is Minddyte. The OS\n' +
    `reuses pids, so process ${pid} may by now belong to something else entirely;\n` +
    "killing it would not be closing Minddyte, it would be closing someone else's\n" +
    'work. If you do not recognise it, the lock is just stale: delete the file\n' +
    'below instead, no process needs to die for that:\n' +
    `  ${lockPath}\n` +
    'Nothing has been changed or deleted.'
  )
}

function otherInstanceMessage(holder: LockRecord, silentMs: number, lockPath: string): string {
  const silentSeconds = Math.round(silentMs / 1000)
  return (
    `Minddyte's database is held by another instance on "${holder.host}".\n` +
    `It last checked in ${silentSeconds}s ago; a live instance checks in every ` +
    `${HEARTBEAT_MS / 1000}s.\n` +
    'During a deploy this is normal and temporary — the previous container has\n' +
    'not shut down yet — and starting again in a moment is the whole fix.\n' +
    'If that instance died without releasing the lock, nothing has to be done\n' +
    `by hand either: the claim expires on its own ${STALE_MS / 1000}s after its\n` +
    `last check-in, which is ${Math.max(0, Math.ceil((STALE_MS - silentMs) / 1000))}s from now.\n` +
    `  ${lockPath}\n` +
    'Nothing has been changed or deleted.'
  )
}

/** The lock sits BESIDE the data directory, so opening the directory cannot disturb it. */
export function lockPathFor(dataDir: string): string {
  const resolved = path.resolve(dataDir)
  return path.join(path.dirname(resolved), `${path.basename(resolved)}.lock`)
}

/**
 * Signal 0 does the existence and permission check WITHOUT delivering a
 * signal — the standard way to ask "is this pid alive?".
 *
 * Only ever asked about a pid on THIS machine. See judgeLock.
 */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    // EPERM means the process exists but belongs to another user. Still alive.
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/**
 * Reads whatever is at `lockPath`, including a file written by the previous
 * format — a bare pid and nothing else.
 *
 * Every installation that predates the lease has one of those on disk right
 * now, so refusing to read it would lock people out of their own database on
 * the first run after an upgrade. A legacy file is read as this host with an
 * epoch-zero check-in, which lands it on the pid path below: exactly the
 * behaviour it had before.
 */
export function readLock(lockPath: string): LockRecord | null {
  let raw: string
  try {
    raw = readFileSync(lockPath, 'utf8').trim()
  } catch {
    return null // no lock file at all: the directory is free
  }
  if (!raw) return null

  const legacyPid = Number.parseInt(raw, 10)
  if (String(legacyPid) === raw && Number.isFinite(legacyPid)) {
    return { holder: `legacy:${legacyPid}`, pid: legacyPid, host: SELF.host, at: 0 }
  }

  try {
    const parsed = JSON.parse(raw) as Partial<LockRecord>
    if (
      typeof parsed.holder !== 'string' ||
      typeof parsed.pid !== 'number' ||
      typeof parsed.host !== 'string' ||
      typeof parsed.at !== 'number'
    ) {
      return null
    }
    return parsed as LockRecord
  } catch {
    return null // corrupt: treat as free rather than lock someone out of their data
  }
}

export type LockVerdict =
  | { take: true; reason: 'free' }
  | { take: true; reason: 'ours' }
  | { take: true; reason: 'dead-pid'; previous: LockRecord }
  | { take: true; reason: 'lease-expired'; previous: LockRecord; silentMs: number }
  | { take: false; reason: 'held'; holder: LockRecord; sameHost: boolean; silentMs: number }

/**
 * Whether this process may take the directory — the entire safety argument,
 * kept pure so that the cases which cannot be staged on a laptop are still
 * decidable in a test.
 *
 * The rule that matters: **a pid is only evidence on the host that wrote
 * it.** Containers have separate pid namespaces, so asking `process.kill`
 * about another container's pid returns a confident answer that is wrong in
 * both directions — it says "alive" about a pid that belongs to something
 * else entirely, and "dead" about an instance that is running perfectly well
 * a namespace away. Across hosts only the lease may decide; within one host
 * the pid is still the fastest, most precise answer available, and keeping it
 * is why a crashed `next dev` costs the next start nothing.
 */
export function judgeLock(
  existing: LockRecord | null,
  me: Identity,
  now: number,
  alive: (pid: number) => boolean = isAlive,
): LockVerdict {
  if (existing === null) return { take: true, reason: 'free' }

  // Ours regardless of age: a process that paused long enough to miss its own
  // heartbeats must not lock itself out of a directory it is still holding.
  if (existing.holder === me.holder) return { take: true, reason: 'ours' }

  const silentMs = now - existing.at

  if (existing.host === me.host) {
    if (!alive(existing.pid)) return { take: true, reason: 'dead-pid', previous: existing }
    return { take: false, reason: 'held', holder: existing, sameHost: true, silentMs }
  }

  if (silentMs > STALE_MS) {
    return { take: true, reason: 'lease-expired', previous: existing, silentMs }
  }
  return { take: false, reason: 'held', holder: existing, sameHost: false, silentMs }
}

function write(lockPath: string, at: number): void {
  writeFileSync(lockPath, JSON.stringify({ ...SELF, at }), 'utf8')
}

export function acquireLock(dataDir: string): string {
  const lockPath = lockPathFor(dataDir)
  mkdirSync(path.dirname(lockPath), { recursive: true })

  const verdict = judgeLock(readLock(lockPath), SELF, Date.now())

  if (!verdict.take) {
    throw new DataDirLockedError(
      verdict.holder.pid,
      lockPath,
      verdict.sameHost
        ? sameMachineMessage(verdict.holder.pid, lockPath)
        : otherInstanceMessage(verdict.holder, verdict.silentMs, lockPath),
    )
  }

  // Say so. A lock that silently disappears teaches nobody anything when the
  // same crash happens again next week.
  if (verdict.reason === 'dead-pid') {
    console.warn(`[minddyte] cleared a stale lock left by dead process ${verdict.previous.pid}`)
  } else if (verdict.reason === 'lease-expired') {
    console.warn(
      `[minddyte] took over a lock from "${verdict.previous.host}" that stopped ` +
        `checking in ${Math.round(verdict.silentMs / 1000)}s ago`,
    )
  }

  write(lockPath, Date.now())
  return lockPath
}

/**
 * Renews this process's claim.
 *
 * It re-reads first and writes only if the record is still ours. A heartbeat
 * that wrote unconditionally would hand the lease back to an instance that
 * had already been replaced — turning the one mechanism protecting the data
 * directory into the thing that lets two writers into it.
 */
export function heartbeat(lockPath: string): void {
  const current = readLock(lockPath)
  if (current?.holder !== SELF.holder) return
  try {
    write(lockPath, Date.now())
  } catch {
    // A transient write failure is not worth crashing a running server over.
    // The lease simply ages; the next beat renews it.
  }
}

/**
 * Keeps the claim fresh until the returned function is called.
 *
 * The timer is unref'd so it never by itself keeps the process alive — a
 * script that has finished its work should exit, not linger because something
 * is still politely renewing a lock.
 */
export function startHeartbeat(lockPath: string): () => void {
  const timer = setInterval(() => heartbeat(lockPath), HEARTBEAT_MS)
  timer.unref?.()
  return () => clearInterval(timer)
}

/**
 * Releases the claim, but only if it is still ours — see heartbeat. Deleting
 * a record another instance wrote would strip a live holder of its lease.
 */
export function releaseLock(lockPath: string): void {
  const current = readLock(lockPath)
  if (current !== null && current.holder !== SELF.holder) return
  try {
    rmSync(lockPath)
  } catch {
    // Already gone. Releasing a lock that is not there is not an error.
  }
}
