import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'

// Whole-branch review, finding 3: when the schema step or the pointer backfill
// threw, open() left its PGlite instance open and its lock behind. conn()
// then retried on the next request, PGlite.create'd the SAME directory again
// (the lock allows it: 'ours'), and every failing retry added a ~226 MB
// instance, with two engines sharing one directory.

const control = vi.hoisted(() => ({ fail: true }))
vi.mock('../../db/data-migrations', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../db/data-migrations')>()
  return {
    ...real,
    runDataMigrations: async (...args: Parameters<typeof real.runDataMigrations>) => {
      if (control.fail) throw new Error('boom in the backfill')
      return real.runDataMigrations(...args)
    },
  }
})

let root: string
let dataDir: string
const previous = process.env.MINDDYTE_DATA_DIR

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), 'minddyte-open-'))
  dataDir = path.join(root, 'minddyte')
  // This file needs a real directory: the lock only exists on disk.
  process.env.MINDDYTE_DATA_DIR = dataDir
})

afterAll(async () => {
  control.fail = false
  const { getClient } = await import('../../db')
  await (await getClient()).close()
  process.env.MINDDYTE_DATA_DIR = previous
  rmSync(root, { recursive: true, force: true })
})

describe('a failed open', () => {
  it('closes its database, releases its lock, names the stage, and can be retried', async () => {
    const { getDb } = await import('../../db')
    const { lockPathFor } = await import('../../db/lock')
    // Keep hold of every instance open() creates, to ask each one if it closed.
    // Only instances on OUR directory: for a fresh directory PGlite also runs a
    // short-lived internal initdb instance, with no dataDir, and closes it.
    const seen = new Set<PGlite>()
    const realCreate = PGlite.create.bind(PGlite)
    const create = vi.spyOn(PGlite, 'create').mockImplementation(async (...args: unknown[]) => {
      const pg = await (realCreate as (...a: unknown[]) => Promise<PGlite>)(...args)
      if ((args[0] as { dataDir?: string } | undefined)?.dataDir === dataDir) seen.add(pg)
      return pg
    })

    const err = await getDb().then(() => null, (e: Error) => e)
    expect(err?.message).toMatch(/could not bring its database up to date: pointer backfill failed/)
    expect(err?.message).toMatch(/NOTHING HAS BEEN DELETED/)
    expect(err?.message).toMatch(/boom in the backfill/)
    expect([...seen].map((pg) => pg.closed)).toEqual([true])
    expect(existsSync(lockPathFor(dataDir))).toBe(false)

    // The cause has passed: the next request opens the same directory cleanly.
    control.fail = false
    await expect(getDb()).resolves.toBeDefined()
    expect(existsSync(lockPathFor(dataDir))).toBe(true)
    expect([...seen].map((pg) => pg.closed)).toEqual([true, false])
    create.mockRestore()
  }, 60_000)
})
