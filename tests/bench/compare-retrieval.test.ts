import { describe, expect, it } from 'vitest'
import { oldFileName } from '../../scripts/bench/compare-retrieval'

/**
 * Final review, minor 7: the old retrieval is written to a file named after
 * the git revision, and a revision like `origin/local-first` has a slash,
 * which made the write fail (it named a folder that does not exist).
 */
describe('oldFileName', () => {
  it('turns any git revision into one plain file name', () => {
    expect(oldFileName('2fd2105')).toBe('retrieval-2fd2105.ts')
    expect(oldFileName('origin/local-first')).toBe('retrieval-origin_local-first.ts')
    expect(oldFileName('HEAD~1')).toBe('retrieval-HEAD_1.ts')
    expect(oldFileName('feature\\x')).toBe('retrieval-feature_x.ts')
  })
})
