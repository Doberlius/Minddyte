import { beforeEach, describe, expect, it } from 'vitest'
import { truncateAll, FIXTURE_WORKSPACE_ID } from '../helpers/pglite'
import { getCore, saveCore, CoreTooLongError } from '@/services/core'

beforeEach(truncateAll)

describe('core service', () => {
  it('is empty until written', async () => {
    expect(await getCore(FIXTURE_WORKSPACE_ID)).toEqual({ text: '', updatedAt: null })
  })
  it('saves and reads back the exact text', async () => {
    await saveCore(FIXTURE_WORKSPACE_ID, 'Main language: TypeScript.\nProject: Minddyte.')
    expect((await getCore(FIXTURE_WORKSPACE_ID)).text).toBe('Main language: TypeScript.\nProject: Minddyte.')
  })
  it('replaces the text on the next save and moves updatedAt', async () => {
    const first = await saveCore(FIXTURE_WORKSPACE_ID, 'A')
    const second = await saveCore(FIXTURE_WORKSPACE_ID, 'B')
    expect(second.text).toBe('B')
    expect(second.updatedAt.getTime()).toBeGreaterThanOrEqual(first.updatedAt.getTime())
  })
  it('refuses over-long text and keeps what was there', async () => {
    await saveCore(FIXTURE_WORKSPACE_ID, 'kept')
    await expect(saveCore(FIXTURE_WORKSPACE_ID, 'x'.repeat(1501))).rejects.toBeInstanceOf(CoreTooLongError)
    expect((await getCore(FIXTURE_WORKSPACE_ID)).text).toBe('kept')
  })
})
