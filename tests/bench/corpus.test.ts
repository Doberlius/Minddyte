import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { dirOfModule } from '../../scripts/bench/corpus'

/**
 * Final review, minor 8: the benchmark found its list files through the
 * module URL's raw `pathname`, which keeps %20 for a space (and %xx for any
 * non-ASCII letter), so a checkout under "My Projects" could not find them.
 */
describe('dirOfModule', () => {
  it('gives the real folder of a module, even with spaces and non-ASCII letters in the path', () => {
    const file = path.resolve('My Projects', 'mìnd dyte', 'corpus.ts')
    expect(dirOfModule(pathToFileURL(file).href)).toBe(path.dirname(file))
  })
})
