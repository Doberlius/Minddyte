// Bundles the diagram runtime into public/scene/ (spec §9). Plain Node + esbuild,
// because Render's Docker build stage has no Bun. Run: node scripts/build-scene.mjs
import { build } from 'esbuild'
import { cpSync, mkdirSync, rmSync } from 'node:fs'

const OUT = 'public/scene'
rmSync(OUT, { recursive: true, force: true })
mkdirSync(`${OUT}/katex`, { recursive: true })

const common = { bundle: true, format: 'iife', minify: true, target: 'es2020', logLevel: 'warning' }

// 1. The worker library, as a string: a worker in an opaque-origin frame can only
//    be started from a Blob, so its source travels inside runtime.js.
const worker = await build({ ...common, entryPoints: ['src/scene/runtime/worker.ts'], write: false })
const workerSource = worker.outputFiles[0].text

// 2. The frame runtime, with the worker source injected.
await build({
  ...common,
  entryPoints: ['src/scene/runtime/frame.ts'],
  outfile: `${OUT}/runtime.js`,
  define: { __WORKER_SOURCE__: JSON.stringify(workerSource) },
})

// 3. KaTeX, served from the same /scene/ path the frame's CSP allows.
cpSync('node_modules/katex/dist/katex.min.js', `${OUT}/katex/katex.min.js`)
cpSync('node_modules/katex/dist/katex.min.css', `${OUT}/katex/katex.min.css`)
cpSync('node_modules/katex/dist/fonts', `${OUT}/katex/fonts`, { recursive: true })

console.log(`scene runtime built: ${OUT}/runtime.js (worker ${Math.round(workerSource.length / 1024)} KB)`)
