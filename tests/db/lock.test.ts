import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  DataDirLockedError,
  HEARTBEAT_MS,
  STALE_MS,
  acquireLock,
  heartbeat,
  judgeLock,
  lockPathFor,
  readLock,
  releaseLock,
  self,
  type LockRecord,
} from '../../db/lock'

let root: string
let dataDir: string

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'minddyte-lock-'))
  dataDir = path.join(root, 'minddyte')
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

/** A holder record that is deliberately not ours. */
function foreign(over: Partial<LockRecord> = {}): LockRecord {
  return {
    holder: '11111111-1111-1111-1111-111111111111',
    pid: 4321,
    host: self().host,
    at: 1_000_000,
    ...over,
  }
}

const alive = () => true
const dead = () => false

/**
 * judgeLock is the whole safety argument, so it is tested as a pure function
 * over an injected clock and liveness check. Every case below is a situation
 * that actually happens; the container ones cannot be reproduced on a laptop
 * at all, which is exactly why they have to be decidable without one.
 */
describe('judgeLock', () => {
  const me = () => self()

  it('takes a directory nobody holds', () => {
    expect(judgeLock(null, me(), 1_000_000, alive)).toEqual({ take: true, reason: 'free' })
  })

  it('recognises its own record rather than refusing itself', () => {
    const mine: LockRecord = { ...me(), at: 0 }

    // `at: 0` is deliberately ancient: our own lock is ours no matter how
    // long ago the heartbeat ran, or a paused process could lock itself out.
    expect(judgeLock(mine, me(), 9_999_999, alive).reason).toBe('ours')
  })

  it('clears a same-host lock the moment its pid is dead, without waiting for the lease', () => {
    // A crashed `next dev` should not cost the next start 30 seconds.
    const v = judgeLock(foreign({ at: 1_000_000 }), me(), 1_000_100, dead)

    expect(v.take).toBe(true)
    expect(v.reason).toBe('dead-pid')
  })

  it('refuses a same-host lock whose pid is alive', () => {
    const v = judgeLock(foreign({ at: 1_000_000 }), me(), 1_000_100, alive)

    expect(v.take).toBe(false)
    expect(v.reason).toBe('held')
  })

  it('NEVER judges another host by pid, even when that pid is dead here', () => {
    // The container bug this design exists to prevent. Two containers have
    // separate pid namespaces, so a pid from one says nothing about the
    // other — asking `process.kill(pid, 0)` about it produces a confident
    // wrong answer in both directions. Only the lease may decide.
    const v = judgeLock(
      foreign({ host: 'other-container', at: 1_000_000 }),
      me(),
      1_000_000 + STALE_MS - 1,
      dead,
    )

    expect(v.take).toBe(false)
    expect(v.reason).toBe('held')
  })

  it('takes over from another host once the lease has expired', () => {
    const v = judgeLock(
      foreign({ host: 'other-container', at: 1_000_000 }),
      me(),
      1_000_000 + STALE_MS + 1,
      alive,
    )

    expect(v.take).toBe(true)
    expect(v.reason).toBe('lease-expired')
  })

  it('holds the lease right up to the boundary, and not past it', () => {
    const at = 1_000_000
    const other = foreign({ host: 'other-container', at })

    expect(judgeLock(other, me(), at + STALE_MS, alive).take).toBe(false)
    expect(judgeLock(other, me(), at + STALE_MS + 1, alive).take).toBe(true)
  })

  it('leaves room for missed heartbeats before calling a lease dead', () => {
    // A lease that expires in less than a few heartbeats would evict a
    // healthy instance that merely lost a scheduler slot.
    expect(STALE_MS).toBeGreaterThanOrEqual(HEARTBEAT_MS * 3)
  })

  it('reports how long the holder has been silent, for the message to use', () => {
    const v = judgeLock(foreign({ host: 'elsewhere', at: 1_000_000 }), me(), 1_012_000, alive)

    expect(v.take).toBe(false)
    expect(v.reason === 'held' && v.silentMs).toBe(12_000)
  })
})

describe('acquireLock', () => {
  it('writes a record naming this process, not a bare pid', () => {
    const lockPath = acquireLock(dataDir)
    const rec = JSON.parse(readFileSync(lockPath, 'utf8')) as LockRecord

    expect(rec.holder).toBe(self().holder)
    expect(rec.pid).toBe(process.pid)
    expect(rec.host).toBe(self().host)
    expect(rec.at).toBeGreaterThan(0)
  })

  it('refuses a foreign lock from another host that is still checking in', () => {
    mkdirSync(path.dirname(dataDir), { recursive: true })
    writeFileSync(
      lockPathFor(dataDir),
      JSON.stringify(foreign({ host: 'other-container', at: Date.now() })),
      'utf8',
    )

    expect(() => acquireLock(dataDir)).toThrow(DataDirLockedError)
  })

  it('names the seconds of silence and the lock file, never just "locked"', () => {
    mkdirSync(path.dirname(dataDir), { recursive: true })
    writeFileSync(
      lockPathFor(dataDir),
      JSON.stringify(foreign({ host: 'other-container', at: Date.now() - 8_000 })),
      'utf8',
    )

    try {
      acquireLock(dataDir)
      expect.unreachable('acquireLock should have thrown')
    } catch (err) {
      // Standing rule: explain, do not just fail.
      const msg = (err as Error).message
      expect(msg).toContain('8s')
      expect(msg).toContain(lockPathFor(dataDir))
    }
  })

  it('still names the pid when the holder is a live process on THIS machine', () => {
    // process.ppid is alive and is not ours — the local `next dev` case,
    // where naming the pid is the whole value of the message.
    mkdirSync(path.dirname(dataDir), { recursive: true })
    writeFileSync(
      lockPathFor(dataDir),
      JSON.stringify(foreign({ pid: process.ppid, at: Date.now() })),
      'utf8',
    )

    try {
      acquireLock(dataDir)
      expect.unreachable('acquireLock should have thrown')
    } catch (err) {
      expect((err as DataDirLockedError).pid).toBe(process.ppid)
      expect((err as Error).message).toContain(String(process.ppid))
    }
  })

  it('takes over a same-host lock whose process died', () => {
    mkdirSync(path.dirname(dataDir), { recursive: true })
    // 4194303 is above Linux's default pid_max and is never a live pid on
    // Windows either, so it reliably represents a crashed previous run.
    writeFileSync(
      lockPathFor(dataDir),
      JSON.stringify(foreign({ pid: 4194303, at: Date.now() })),
      'utf8',
    )

    const rec = readLock(acquireLock(dataDir))
    expect(rec?.holder).toBe(self().holder)
  })

  it('warns when it clears a stale lock, so a real crash is still visible', () => {
    mkdirSync(path.dirname(dataDir), { recursive: true })
    writeFileSync(
      lockPathFor(dataDir),
      JSON.stringify(foreign({ pid: 4194303, at: Date.now() })),
      'utf8',
    )
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    acquireLock(dataDir)

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('4194303'))
    warn.mockRestore()
  })

  it('re-acquiring in the same process is allowed', () => {
    acquireLock(dataDir)
    expect(() => acquireLock(dataDir)).not.toThrow()
  })

  it('ignores a corrupt lock file rather than crashing', () => {
    mkdirSync(path.dirname(dataDir), { recursive: true })
    writeFileSync(lockPathFor(dataDir), '{ not json', 'utf8')
    expect(() => acquireLock(dataDir)).not.toThrow()
  })

  describe('a lock file written by the previous format', () => {
    // Every existing installation has one of these on disk right now — a
    // bare pid, no record. Refusing to read it would lock people out of
    // their own database on the first run after an upgrade.
    it('accepts one whose pid is dead', () => {
      mkdirSync(path.dirname(dataDir), { recursive: true })
      writeFileSync(lockPathFor(dataDir), '4194303', 'utf8')

      const rec = readLock(acquireLock(dataDir))
      expect(rec?.holder).toBe(self().holder)
    })

    it('refuses one whose pid is alive, and still names it', () => {
      mkdirSync(path.dirname(dataDir), { recursive: true })
      writeFileSync(lockPathFor(dataDir), String(process.ppid), 'utf8')

      try {
        acquireLock(dataDir)
        expect.unreachable('acquireLock should have thrown')
      } catch (err) {
        expect((err as DataDirLockedError).pid).toBe(process.ppid)
      }
    })
  })
})

describe('heartbeat', () => {
  it('moves the timestamp forward without changing who holds the lock', () => {
    const lockPath = acquireLock(dataDir)
    const before = readLock(lockPath)!

    vi.setSystemTime(new Date(Date.now() + 10_000))
    heartbeat(lockPath)
    const after = readLock(lockPath)!
    vi.useRealTimers()

    expect(after.holder).toBe(before.holder)
    expect(after.at).toBeGreaterThan(before.at)
  })

  it('does not resurrect a lock this process no longer holds', () => {
    // After release, a stray heartbeat must not recreate the file — that
    // would hand a dead instance's lease back to it and block the live one.
    const lockPath = acquireLock(dataDir)
    releaseLock(lockPath)

    heartbeat(lockPath)

    expect(readLock(lockPath)).toBeNull()
  })

  it('does not overwrite a lock that another instance has taken', () => {
    const lockPath = acquireLock(dataDir)
    const theirs = foreign({ host: 'other-container', at: Date.now() })
    writeFileSync(lockPath, JSON.stringify(theirs), 'utf8')

    heartbeat(lockPath)

    expect(readLock(lockPath)!.holder).toBe(theirs.holder)
  })
})

describe('releaseLock', () => {
  it('removes the file and tolerates being called twice', () => {
    const lockPath = acquireLock(dataDir)
    releaseLock(lockPath)
    expect(() => releaseLock(lockPath)).not.toThrow()
  })

  it('does not delete a lock another instance now holds', () => {
    const lockPath = acquireLock(dataDir)
    const theirs = foreign({ host: 'other-container', at: Date.now() })
    writeFileSync(lockPath, JSON.stringify(theirs), 'utf8')

    releaseLock(lockPath)

    expect(readLock(lockPath)!.holder).toBe(theirs.holder)
  })
})
