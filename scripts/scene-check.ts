/**
 * Browser checks for the diagram sandbox (spec §4, §10), on the installed
 * Microsoft Edge via playwright-core. Serves public/ and a harness page on a
 * random localhost port; the harness builds the frame exactly like
 * ScenePlayer does. Run after `node scripts/build-scene.mjs`:
 *   npx tsx scripts/scene-check.ts
 * Exits 1 on any failed check.
 */
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import type { AddressInfo } from 'node:net'
import { chromium, type Page } from 'playwright-core'
import { buildFrameDoc } from '../src/scene/frameDoc'

const TYPES: Record<string, string> = {
  '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf',
}
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function harness(origin: string): string {
  return `<!doctype html><html><body style="margin:0;background:#fff">
<iframe id="f" sandbox="allow-scripts" style="width:800px;height:560px;border:0" srcdoc="${esc(buildFrameDoc(origin))}"></iframe>
<script>
  window.msgs = [];
  const f = document.getElementById('f');
  addEventListener('message', (e) => { if (e.source === f.contentWindow) window.msgs.push(e.data); });
  window.render = (code, autoplay) => f.contentWindow.postMessage({ type: 'render', code, autoplay: !!autoplay }, '*');
</script></body></html>`
}

async function serve(): Promise<{ origin: string; close: () => void }> {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x')
    if (url.pathname === '/harness.html') {
      res.writeHead(200, { 'content-type': 'text/html' }).end(harness(`http://127.0.0.1:${(server.address() as AddressInfo).port}`))
      return
    }
    const path = normalize(join('public', decodeURIComponent(url.pathname)))
    if (!path.startsWith('public')) return void res.writeHead(403).end()
    try {
      // Read before writing headers: writeHead().end(await readFile(path)) would
      // call writeHead(200) synchronously and only THEN await the read, so a
      // missing file (favicon.ico, say) hit the catch's writeHead(404) after
      // headers were already sent and crashed the server.
      const data = await readFile(path)
      res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' }).end(data)
    } catch {
      res.writeHead(404).end()
    }
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  return { origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close: () => server.close() }
}

type Msg = { type: string; kind?: string; message?: string }
async function run(page: Page, code: string): Promise<{ msg: Msg; ms: number }> {
  await page.evaluate(() => { (window as unknown as { msgs: unknown[] }).msgs.length = 0 })
  const t0 = Date.now()
  await page.evaluate((c) => (window as unknown as { render(c: string): void }).render(c), code)
  const handle = await page.waitForFunction(
    () => (window as unknown as { msgs: Msg[] }).msgs.find((m) => m.type === 'done' || m.type === 'error'),
    null,
    { timeout: 15000 },
  )
  return { msg: (await handle.jsonValue()) as Msg, ms: Date.now() - t0 }
}

export type Check = { name: string; code: string; expect: (r: { msg: Msg; ms: number }) => string | null }

/** Sandbox checks (Task 1). Task 5 appends render checks to CHECKS. */
export const CHECKS: Check[] = [
  { name: 'runs a trivial scene', code: '', expect: ({ msg }) => (msg.type === 'done' ? null : `got ${JSON.stringify(msg)}`) },
  {
    name: 'worker has an opaque origin',
    code: "if (self.origin !== 'null') throw new Error('origin ' + self.origin)",
    expect: ({ msg }) => (msg.type === 'done' ? null : `got ${JSON.stringify(msg)}`),
  },
  {
    name: 'worker network is blocked',
    code: "var x = new XMLHttpRequest(); x.open('GET', 'https://example.com/', false); x.send(); throw new Error('network was allowed')",
    expect: ({ msg }) =>
      msg.type === 'error' && !String(msg.message).includes('network was allowed') ? null : `got ${JSON.stringify(msg)}`,
  },
  {
    name: 'an infinite loop stops at ~2 s',
    code: 'while (true) {}',
    expect: ({ msg, ms }) =>
      msg.type === 'error' && msg.kind === 'timeout' && ms >= 1800 && ms < 4000 ? null : `got ${JSON.stringify(msg)} after ${ms} ms`,
  },
  {
    name: 'a syntax error is reported',
    code: 'this is not javascript',
    expect: ({ msg }) => (msg.type === 'error' && msg.kind === 'error' ? null : `got ${JSON.stringify(msg)}`),
  },
  {
    name: 'draws a sine scene with a slider',
    code: 'title("sine"); const k = slider("k", 1, 5, 2); const ax = axes({ x: [-PI, PI], y: [-1.5, 1.5] }); play(create(ax)); caption("y = sin(kx)"); play(create(ax.plot(x => sin(k * x), { color: BLUE })))',
    expect: ({ msg }) => (msg.type === 'done' ? null : `got ${JSON.stringify(msg)}`),
  },
  {
    name: 'an unknown function is named in the error',
    code: 'play(create(sphere()))',
    expect: ({ msg }) => (msg.type === 'error' && /sphere/.test(String(msg.message)) ? null : `got ${JSON.stringify(msg)}`),
  },
  {
    name: 'a scene past the shape limit is "too large"',
    code: 'for (let i = 0; i < 500; i++) point([0, 0])',
    expect: ({ msg }) => (msg.type === 'error' && msg.kind === 'limits' ? null : `got ${JSON.stringify(msg)}`),
  },
]

async function main() {
  const { origin, close } = await serve()
  const browser = await chromium.launch({ channel: 'msedge', headless: true })
  const page = await browser.newPage()
  const failures: string[] = []
  try {
    await page.goto(`${origin}/harness.html`)
    await page.waitForFunction(() => (window as unknown as { msgs: Msg[] }).msgs.some((m) => m.type === 'ready'), null, { timeout: 15000 })
    const opaque = await page.evaluate(() => (document.getElementById('f') as HTMLIFrameElement).contentDocument === null)
    console.log(`${opaque ? 'PASS' : 'FAIL'}  frame is cross-origin to the page`)
    if (!opaque) failures.push('frame is cross-origin to the page')
    for (const c of CHECKS) {
      const problem = c.expect(await run(page, c.code))
      console.log(`${problem ? 'FAIL' : 'PASS'}  ${c.name}${problem ? `: ${problem}` : ''}`)
      if (problem) failures.push(c.name)
    }
    await run(page, CHECKS.find((c) => c.name.startsWith('draws a sine'))!.code)
    const frame = page.frameLocator('#f')
    await frame.locator('.sliders input').first().fill('4')
    await page.waitForTimeout(600)
    const curve = await frame.locator('svg path').count()
    console.log(`${curve > 5 ? 'PASS' : 'FAIL'}  slider re-run keeps a drawn scene (${curve} paths)`)
    if (curve <= 5) failures.push('slider re-run')
    await page.locator('#f').screenshot({ path: 'public/scene-check.png' })
    console.log('screenshot: public/scene-check.png (not committed)')
  } finally {
    await browser.close()
    close()
  }
  if (failures.length) {
    console.error(`\n${failures.length} check(s) failed`)
    process.exit(1)
  }
  console.log('\nall scene checks passed (Microsoft Edge)')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
