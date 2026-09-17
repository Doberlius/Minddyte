import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Integration tests join the ordinary `bun run test`. A separate
    // test:integration script is one that does not get run when someone is in
    // a hurry — which is exactly when the `= any()` class of bug ships.
    //
    // forks, not threads: each test FILE gets its own process, so each gets its
    // own globalThis and therefore its own PGlite. That is what makes "one
    // instance per file" true without any test-only code in db/index.ts.
    pool: 'forks',
    // 1116 ms of PGlite boot per file is comfortably inside this, but the
    // default 5 s is not once a file also seeds and asserts.
    testTimeout: 20_000,
    hookTimeout: 30_000,
    env: {
      // In-memory: no data directory, so no lock and no contention between the
      // parallel files. The on-disk hazard from ticket 01 does not apply.
      MINDDYTE_DATA_DIR: 'memory://',
    },
  },
})
