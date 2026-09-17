import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

/**
 * Thrown when another LIVE process already has the data directory open.
 *
 * It carries the pid because the standing rule is to explain rather than to
 * fail blankly — a message saying "locked" leaves someone guessing which
 * terminal to close.
 */
export class DataDirLockedError extends Error {
  constructor(readonly pid: number, readonly lockPath: string) {
    super(
      `Minddyte's database is already open in process ${pid}.\n` +
        'Close that process first. If you are certain it is gone, delete the lock file:\n' +
        `  ${lockPath}\n` +
        'Nothing has been changed or deleted.',
    )
    this.name = 'DataDirLockedError'
  }
}

/**
 * Signal 0 does the existence and permission check WITHOUT delivering a
 * signal — the standard way to ask "is this pid alive?". It works on Windows
 * too, which matters more here than it looks: on Windows being killed is the
 * ordinary way a process exits, so a stale lock is the COMMON case, not an
 * edge case.
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

/** The lock sits BESIDE the data directory, so opening the directory cannot disturb it. */
export function lockPathFor(dataDir: string): string {
  const resolved = path.resolve(dataDir)
  return path.join(path.dirname(resolved), `${path.basename(resolved)}.lock`)
}

export function acquireLock(dataDir: string): string {
  const lockPath = lockPathFor(dataDir)
  mkdirSync(path.dirname(lockPath), { recursive: true })

  let held: number | null = null
  try {
    const parsed = Number.parseInt(readFileSync(lockPath, 'utf8').trim(), 10)
    held = Number.isFinite(parsed) ? parsed : null
  } catch {
    held = null // no lock file at all: the directory is free
  }

  if (held !== null && held !== process.pid) {
    if (isAlive(held)) throw new DataDirLockedError(held, lockPath)
    // Say so. A lock that silently disappears teaches nobody anything when
    // the same crash happens again next week.
    console.warn(`[minddyte] cleared a stale lock left by dead process ${held}`)
  }

  writeFileSync(lockPath, String(process.pid), 'utf8')
  return lockPath
}

export function releaseLock(lockPath: string): void {
  try {
    rmSync(lockPath)
  } catch {
    // Already gone. Releasing a lock that is not there is not an error.
  }
}
