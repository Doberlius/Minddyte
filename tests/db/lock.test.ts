import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DataDirLockedError, acquireLock, lockPathFor, releaseLock } from '../../db/lock'

let root: string
let dataDir: string

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'minddyte-lock-'))
  dataDir = path.join(root, 'minddyte')
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('data directory lock', () => {
  it('writes this process id when the directory is free', () => {
    const lockPath = acquireLock(dataDir)
    expect(readFileSync(lockPath, 'utf8')).toBe(String(process.pid))
  })

  it('refuses when a LIVE process holds it, and names the pid', () => {
    // process.ppid is a pid we know is alive and is not our own, which is
    // exactly the live-holder case without spawning anything.
    mkdirSync(path.dirname(dataDir), { recursive: true })
    writeFileSync(lockPathFor(dataDir), String(process.ppid), 'utf8')

    expect(() => acquireLock(dataDir)).toThrow(DataDirLockedError)
    try {
      acquireLock(dataDir)
      expect.unreachable('acquireLock should have thrown')
    } catch (err) {
      // Standing rule: explain, do not just fail.
      expect((err as DataDirLockedError).pid).toBe(process.ppid)
      expect((err as Error).message).toContain(lockPathFor(dataDir))
    }
  })

  it('clears a STALE lock left by a dead process and continues', () => {
    mkdirSync(path.dirname(dataDir), { recursive: true })
    // 4194303 is above Linux's default pid_max and is never a live pid on
    // Windows either, so it reliably represents a crashed previous run.
    writeFileSync(lockPathFor(dataDir), '4194303', 'utf8')

    const lockPath = acquireLock(dataDir)
    expect(readFileSync(lockPath, 'utf8')).toBe(String(process.pid))
  })

  it('re-acquiring in the same process is allowed', () => {
    acquireLock(dataDir)
    expect(() => acquireLock(dataDir)).not.toThrow()
  })

  it('releaseLock removes the file and tolerates being called twice', () => {
    const lockPath = acquireLock(dataDir)
    releaseLock(lockPath)
    expect(() => releaseLock(lockPath)).not.toThrow()
  })

  it('ignores a corrupt lock file rather than crashing', () => {
    mkdirSync(path.dirname(dataDir), { recursive: true })
    writeFileSync(lockPathFor(dataDir), 'not-a-pid', 'utf8')
    expect(() => acquireLock(dataDir)).not.toThrow()
  })
})
