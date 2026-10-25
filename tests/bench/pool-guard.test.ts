import { describe, expect, it } from 'vitest'
import { scratchDataDirProblem } from '../../scripts/bench/pool'

/**
 * Final review, finding 1: the benchmark pools every chat into one workspace,
 * which merges and deletes rows for good. Without MINDDYTE_DATA_DIR the app
 * opens the REAL database (./.data/minddyte), so the benchmark must refuse to
 * run unless it is pointed at a directory outside any `.data` folder.
 */
describe('scratchDataDirProblem', () => {
  it('refuses when MINDDYTE_DATA_DIR is not set', () => {
    expect(scratchDataDirProblem(undefined)).toMatch(/MINDDYTE_DATA_DIR/)
    expect(scratchDataDirProblem('')).toMatch(/MINDDYTE_DATA_DIR/)
  })

  it('refuses the real database and any other .data folder', () => {
    for (const dir of [
      './.data/minddyte',
      '.data/minddyte',
      'D:/Coding/minddyte/.data/minddyte',
      'D:\\Coding\\minddyte\\.claude\\worktrees\\long-draft\\.data\\minddyte',
      '/home/me/minddyte/.data/walk2',
    ]) {
      expect(scratchDataDirProblem(dir), dir).toMatch(/\.data/)
    }
  })

  it('accepts a copy outside any .data folder', () => {
    expect(scratchDataDirProblem('C:/Users/me/AppData/Local/Temp/ld-real/minddyte')).toBeNull()
    expect(scratchDataDirProblem('/tmp/bench-db')).toBeNull()
  })
})
