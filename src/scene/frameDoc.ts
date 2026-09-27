/**
 * The sandboxed diagram frame's whole document (spec §4).
 *
 * The frame is `<iframe sandbox="allow-scripts" srcdoc=…>` WITHOUT
 * allow-same-origin: an opaque origin, so no cookies, no storage, no access to
 * the page or the API. This CSP then takes away the network: there is no
 * connect-src, so fetch/XHR/WebSocket are blocked in the frame and in any
 * worker it starts. Scripts, styles and fonts come only from /scene/ on the
 * page's own origin. No inline script exists, so no nonce is needed.
 */
export const SCENE_PATH = '/scene/'

const ORIGIN = /^https?:\/\/[A-Za-z0-9.-]+(:\d+)?$/

export function frameCsp(origin: string): string {
  const base = `${origin}${SCENE_PATH}`
  return [
    "default-src 'none'",
    `script-src ${base}`,
    `style-src ${base} 'unsafe-inline'`,
    `font-src ${base}`,
    'worker-src blob:',
    'child-src blob:',
    'img-src data:',
  ].join('; ')
}

export function buildFrameDoc(origin: string): string {
  if (!ORIGIN.test(origin)) throw new Error(`Not a plain origin: ${origin}`)
  const base = `${origin}${SCENE_PATH}`
  return (
    '<!doctype html><html><head><meta charset="utf-8">' +
    `<meta http-equiv="Content-Security-Policy" content="${frameCsp(origin)}">` +
    `<link rel="stylesheet" href="${base}katex/katex.min.css">` +
    `<script src="${base}katex/katex.min.js"></script>` +
    `<script src="${base}runtime.js"></script>` +
    '</head><body></body></html>'
  )
}
