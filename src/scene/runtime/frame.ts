/**
 * The diagram player inside the sandboxed frame (spec §4–§7): runs the scene
 * code in a worker, paints frames with SVG plus KaTeX labels, and owns the
 * playback controls and sliders. It talks to the page only through protocol.ts.
 */
import { runScene } from './run'
import { captionAt, frameAt, totalDuration, type Visual } from './render'
import type { FromFrame, ToFrame } from './protocol'
import { BACKGROUND, type Scene } from '../types'

declare const katex: { renderToString(tex: string, o: { throwOnError: boolean; displayMode?: boolean }): string }

const post = (m: FromFrame) => window.parent.postMessage(m, '*')
const SVG = 'http://www.w3.org/2000/svg'
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const css = `
  html, body { margin: 0; background: ${BACKGROUND}; color: #E8E8EA; font: 13px/1.4 system-ui, -apple-system, 'Segoe UI', sans-serif; }
  .stage { position: relative; width: 100%; aspect-ratio: 16 / 9; overflow: hidden; }
  .stage svg { position: absolute; inset: 0; width: 100%; height: 100%; }
  .labels { position: absolute; inset: 0; pointer-events: none; }
  .labels > div { position: absolute; transform: translate(-50%, -50%); white-space: nowrap; line-height: 1; }
  .title { position: absolute; left: 14px; top: 10px; font-size: 13px; color: #B8B8C0; }
  .bar { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-top: 1px solid #26262B; }
  .bar button { background: #1C1C21; color: #E8E8EA; border: 1px solid #33333A; border-radius: 6px; padding: 3px 10px; font: inherit; cursor: pointer; }
  .bar button:hover { background: #26262D; }
  .bar button:focus-visible, input:focus-visible { outline: 2px solid #58C4DD; outline-offset: 1px; }
  .bar input[type=range] { flex: 0 0 34%; accent-color: #58C4DD; }
  .caption { flex: 1; min-width: 0; color: #C8C8D0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sliders { display: grid; grid-template-columns: max-content 1fr 3.5em; gap: 4px 10px; align-items: center; padding: 4px 12px 10px; }
  .sliders:empty { display: none; }
  .sliders label { color: #B8B8C0; }
  .sliders input { accent-color: #FFFF00; }
  .sliders output { color: #E8E8EA; font-variant-numeric: tabular-nums; text-align: right; }
  .note { padding: 0 12px 8px; color: #FC6255; }
  .note:empty { display: none; }
`

let scene: Scene | null = null
let code = ''
let values: Record<string, number> = {}
let t = 0
let playing = false
let lastTs = 0
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches

// frameDoc.ts loads this script from <head>, so it runs while the parser is
// still inside <head> — document.body is still null at that point. Deferring
// all DOM setup to DOMContentLoaded (or running it immediately if the
// document has already finished loading) avoids a null-appendChild crash.
let root!: HTMLDivElement
let stage!: HTMLDivElement
let layer!: SVGGElement
let labels!: HTMLDivElement
let playBtn!: HTMLButtonElement
let scrub!: HTMLInputElement
let caption!: HTMLSpanElement
let sliderBox!: HTMLDivElement
let note!: HTMLDivElement
let titleBox!: HTMLDivElement

const svgEls = new Map<string, SVGElement>()
const labelEls = new Map<string, { el: HTMLDivElement; key: string }>()

function paint() {
  if (!scene) return
  const vis = frameAt(scene, t)
  for (const [id, el] of svgEls) if (!vis.has(id) || vis.get(id)!.shape.kind === 'label') { el.remove(); svgEls.delete(id) }
  for (const [id, l] of labelEls) if (!vis.has(id) || vis.get(id)!.shape.kind !== 'label') { l.el.remove(); labelEls.delete(id) }
  // Paint in creation order (s1, s2, …) so later shapes sit on top.
  const ids = [...vis.keys()].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))
  for (const id of ids) drawOne(id, vis.get(id)!)
  caption.textContent = captionAt(scene, t) ?? ''
  scrub.value = String(t)
  playBtn.textContent = playing ? '⏸' : '▶'
  playBtn.setAttribute('aria-label', playing ? 'Pause' : 'Play')
}

function drawOne(id: string, v: Visual) {
  const s = v.shape
  if (s.kind === 'label') {
    let l = labelEls.get(id)
    if (!l) { l = { el: document.createElement('div'), key: '' }; labels.appendChild(l.el); labelEls.set(id, l) }
    const key = `${s.tex}|${s.text}`
    if (l.key !== key) {
      l.el.innerHTML = s.tex ? katex.renderToString(s.text, { throwOnError: false }) : esc(s.text)
      l.key = key
    }
    l.el.style.left = `${((s.at[0] + 8) / 16) * 100}%`
    l.el.style.top = `${((4.5 - s.at[1]) / 9) * 100}%`
    l.el.style.fontSize = `calc(var(--u) * ${s.size})`
    l.el.style.color = s.color
    l.el.style.opacity = String(v.opacity)
    return
  }
  const tag = s.kind === 'poly' ? 'path' : 'circle'
  let el = svgEls.get(id)
  if (!el || el.tagName !== tag) { el?.remove(); el = document.createElementNS(SVG, tag) as SVGElement; svgEls.set(id, el) }
  layer.appendChild(el) // re-append keeps creation order
  if (s.kind === 'poly') {
    const d = s.points.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(4)} ${y.toFixed(4)}`).join('') + (s.closed ? 'Z' : '')
    el.setAttribute('d', d)
    el.setAttribute('stroke', s.stroke)
    el.setAttribute('stroke-width', String(s.width))
    el.setAttribute('fill', s.fill ?? 'none')
    el.setAttribute('stroke-linecap', 'round')
    el.setAttribute('stroke-linejoin', 'round')
    el.setAttribute('pathLength', '1')
    if (v.draw < 1) { el.setAttribute('stroke-dasharray', '1'); el.setAttribute('stroke-dashoffset', String(1 - v.draw)) }
    else { el.removeAttribute('stroke-dasharray'); el.removeAttribute('stroke-dashoffset') }
  } else {
    el.setAttribute('cx', String(s.c[0]))
    el.setAttribute('cy', String(s.c[1]))
    el.setAttribute('r', String(s.r))
    el.setAttribute('stroke', s.stroke ?? 'none')
    el.setAttribute('stroke-width', String(s.width))
    el.setAttribute('fill', s.fill ?? 'none')
  }
  el.setAttribute('opacity', String(v.opacity))
}

function tick(ts: number) {
  if (playing && scene) {
    t = Math.min(totalDuration(scene), t + (lastTs ? (ts - lastTs) / 1000 : 0))
    if (t >= totalDuration(scene)) playing = false
    paint()
  }
  lastTs = ts
  requestAnimationFrame(tick)
}

function show(next: Scene, autoplay: boolean) {
  scene = next
  const total = totalDuration(next)
  scrub.max = String(total)
  titleBox.textContent = next.title ?? ''
  t = autoplay && !reduced ? 0 : total // Decision 2: a reopened chat shows the finished diagram
  playing = autoplay && !reduced && total > 0
  note.textContent = '' // a stale "this value breaks the diagram" note must not outlive the scene it was about
  renderSliders(next)
  paint()
}

// One counter shared by every in-flight run (a top-level render or a slider
// re-run): bumped whenever either starts, so an older run's result — however
// it finishes, success or failure — is discarded once a newer one has
// started. This is what stops a slow slider re-run from clobbering a
// top-level render that arrived while it was still awaiting the worker, and
// what stops two rapid slider drags from racing each other.
let gen = 0

function renderSliders(s: Scene) {
  sliderBox.innerHTML = ''
  for (const def of s.sliders) {
    const id = `k${Math.random().toString(36).slice(2)}`
    const lab = document.createElement('label'); lab.htmlFor = id; lab.textContent = def.name
    const input = document.createElement('input')
    Object.assign(input, { type: 'range', id, min: String(def.min), max: String(def.max), step: String(def.step), value: String(def.value) })
    const out = document.createElement('output'); out.textContent = String(def.value)
    input.addEventListener('input', () => {
      out.textContent = input.value
      values[def.name] = Number(input.value)
      const myGen = ++gen
      const runCode = code
      const runValues = { ...values } // a snapshot: a later top-level render may reassign the module-level `values`
      setTimeout(async () => {
        if (myGen !== gen) return
        const r = await runScene(runCode, runValues)
        if (myGen !== gen) return
        if (r.ok) { note.textContent = ''; const sc = r.scene as Scene; scene = sc; scrub.max = String(totalDuration(sc)); t = totalDuration(sc); playing = false; paint() }
        else note.textContent = `This value breaks the diagram: ${r.message}` // Decision 7
      }, 120)
    })
    sliderBox.append(lab, input, out)
  }
}

function init() {
  root = document.createElement('div')
  const style = document.createElement('style')
  style.textContent = css
  document.head.appendChild(style)
  root.innerHTML = `<div class="stage"><svg viewBox="-8 -4.5 16 9" preserveAspectRatio="xMidYMid meet"><g transform="scale(1,-1)"></g></svg><div class="labels"></div><div class="title"></div></div>
<div class="bar"><button class="play" aria-label="Play">▶</button><button class="replay" aria-label="Replay">↺</button><input class="scrub" type="range" min="0" max="1" step="0.01" value="0" aria-label="Scrub"><span class="caption"></span></div>
<div class="sliders"></div><div class="note" role="status"></div>`
  document.body.appendChild(root)

  stage = $<HTMLDivElement>('.stage')
  layer = $<SVGGElement>('svg g')
  labels = $<HTMLDivElement>('.labels')
  playBtn = $<HTMLButtonElement>('.play')
  scrub = $<HTMLInputElement>('.scrub')
  caption = $<HTMLSpanElement>('.caption')
  sliderBox = $<HTMLDivElement>('.sliders')
  note = $<HTMLDivElement>('.note')
  titleBox = $<HTMLDivElement>('.title')

  playBtn.addEventListener('click', () => {
    if (!scene) return
    if (!playing && t >= totalDuration(scene)) t = 0
    playing = !playing
    paint()
  })
  $<HTMLButtonElement>('.replay').addEventListener('click', () => { if (scene) { t = 0; playing = true; paint() } })
  scrub.addEventListener('input', () => { playing = false; t = Number(scrub.value); paint() })

  new ResizeObserver(() => {
    stage.style.setProperty('--u', `${stage.clientWidth / 16}px`)
    post({ type: 'height', px: Math.ceil(document.documentElement.scrollHeight) })
  }).observe(document.body)

  window.addEventListener('message', async (ev: MessageEvent) => {
    if (ev.source !== window.parent) return
    const m = ev.data as ToFrame
    if (m?.type !== 'render' || typeof m.code !== 'string') return
    const myGen = ++gen // also invalidates any slider re-run still in flight
    code = m.code
    values = {}
    const r = await runScene(code, values)
    if (myGen !== gen) return // a newer render arrived meanwhile: only the last one may show
    if (!r.ok) { post({ type: 'error', kind: r.kind, message: r.message }); return }
    show(r.scene as Scene, !!m.autoplay)
    post({ type: 'done' })
  })

  requestAnimationFrame(tick)
  if (typeof Worker === 'undefined') post({ type: 'error', kind: 'unsupported', message: 'This browser cannot run diagrams.' })
  else post({ type: 'ready' })
}

// `$` needs `root` to exist, so it is only ever called from inside init() or
// functions init() calls.
function $<T extends Element>(sel: string): T {
  return root.querySelector(sel) as T
}

if (document.body) init()
else document.addEventListener('DOMContentLoaded', init)
