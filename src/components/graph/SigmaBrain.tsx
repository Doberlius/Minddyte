'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import Graph from 'graphology'
import Sigma from 'sigma'
import { Maximize, Minus, Plus } from 'lucide-react'
import type { ViewGraph } from '@/types/graph'
import { layoutGraph } from '@/lib/graph-layout'
import { CardProgram, NoHoverProgram } from './sigma/CardProgram'
import { makeCardDrawers, makePillMeasure } from './sigma/drawCard'
import {
  buildBrainGraph,
  chatNodeId,
  fadeAt,
  fadedColor,
  mapGraph,
  nodeIdOf,
  selectionOf,
  type BrainEdgeAttributes,
  type BrainNodeAttributes,
  type BrainPalette,
  type Selection,
} from './sigma/brainGraph'

/**
 * The Brain's map, drawn with WebGL through Sigma.js.
 *
 * It replaced a React Flow canvas, which put one DOM element on the page for
 * every card, pill and line. That is lovely to style and falls over at a few
 * thousand nodes, which one chat with a pasted book reaches on its own.
 * Sigma draws all of them in a handful of WebGL calls, and the card look is
 * kept with two of its public extension points rather than a fork:
 *
 *   CardProgram  draws every card and pill as a rounded box
 *   drawCard     writes their text on Sigma's label canvas
 *
 * What a canvas gives up, and where it was put back:
 *
 * - Text on a canvas cannot be read by a screen reader or reached by Tab.
 *   The list beside the map (BrainList) holds every chat and shared concept
 *   as real buttons, and choosing one selects it here too.
 * - A canvas node cannot hold a button. Selecting one opens `panel`, real
 *   HTML pinned beside the node, which is where "Open chat" and Forget live.
 *
 * The positions still come from `layoutGraph`, so the same graph draws the
 * same picture on every load, exactly as before.
 */

/**
 * Below this zoom a card's title (13px × 0.6 ≈ 8px) stops being readable and
 * pill labels are skipped altogether, so no automatic frame goes further out.
 */
const READABLE = 0.6
/** An automatic frame never blows a card up past this. */
const LARGEST = 1.6
/** One cell of the dot grid behind the map, in graph units: React Flow's old 26px. */
const DOT_GAP = 26

/** The canvas cannot read CSS variables, so the tokens are read once and passed in as values. */
function readPalette(): BrainPalette {
  const css = getComputedStyle(document.documentElement)
  const tok = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback
  return {
    surface: tok('--white', '#FFFFFF'),
    ink: tok('--ink', '#1A1A2E'),
    ink2: tok('--ink2', '#5C6370'),
    ink3: tok('--ink3', '#676E7C'),
    violet: tok('--violet', '#4F46E8'),
    border: tok('--border', '#E5E7EB'),
    pillBorder: tok('--pill-border', '#D3D6DF'),
    lineQuiet: tok('--line-quiet', '#C8CCD8'),
    lineStrong: tok('--line-strong', '#8C84E4'),
  }
}

const reducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * Sigma over its plain attribute type. Typed with the Brain's own attributes,
 * every program and drawing hook would need the same three type parameters
 * threaded through; the attributes are read back in one place (`placePanel`),
 * which casts.
 */
type Renderer = Sigma

/**
 * Screen pixels per graph unit if the camera were at ratio 1 (the whole graph
 * in view). Measured by projecting two points through that camera, rather than
 * read from Sigma's own scale, which it only updates while rendering and so
 * was still stale (from a hidden, 1px canvas) when the first frame asked.
 */
function unitAtRatioOne(renderer: Renderer) {
  const cameraState = { x: 0.5, y: 0.5, ratio: 1, angle: 0 }
  const a = renderer.graphToViewport({ x: 0, y: 0 }, { cameraState })
  const b = renderer.graphToViewport({ x: 100, y: 0 }, { cameraState })
  return Math.hypot(b.x - a.x, b.y - a.y) / 100
}

/**
 * Point the camera at `ids` (or at everything), never so far out that the
 * cards stop being readable and never so close that two nodes fill a screen.
 *
 * The floor matters most on a phone. Fitted whole, forty chats on a 360px
 * screen are a field of specks with not one readable title: a picture of a
 * graph rather than a graph. Clamped, the view crops instead, and you pan.
 */
function frame(renderer: Renderer, ids: string[] | null, animate: boolean) {
  const camera = renderer.getCamera()
  const k1 = unitAtRatioOne(renderer)
  let target = { x: 0.5, y: 0.5, ratio: 1 }

  const points = (ids ?? []).map((id) => renderer.getNodeDisplayData(id)).filter((d) => !!d)
  if (points.length > 0) {
    const xs = points.map((p) => p.x)
    const ys = points.map((p) => p.y)
    const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
    target = {
      x: (minX + maxX) / 2,
      y: (minY + maxY) / 2,
      // Padding for the cards' own size, which the centre points leave out.
      ratio: Math.max(maxX - minX, maxY - minY) * 1.25 + 0.12,
    }
  }

  // Zoom k = k1 / ratio, so a zoom floor is a ratio CEILING and vice versa.
  target.ratio = Math.min(target.ratio, k1 / READABLE)
  target.ratio = Math.max(target.ratio, k1 / (points.length > 0 ? 1 : LARGEST))

  if (animate && !reducedMotion()) void camera.animate(target, { duration: 420, easing: 'quadraticOut' })
  else camera.setState(target)
}

export function SigmaBrain({
  graph,
  highlight,
  highlightLabel,
  focusId,
  selected,
  selectedFrom,
  onSelect,
  panel,
  onUnavailable,
}: {
  graph: ViewGraph
  highlight: string[]
  highlightLabel: string
  /** The open conversation, which the first frame centres on. */
  focusId: string | null
  selected: Selection | null
  /** A choice made in the list moves the camera to it; a click on the map already has it in view. */
  selectedFrom: 'map' | 'list'
  onSelect: (s: Selection | null) => void
  /** The details for `selected`, pinned beside it. */
  panel: ReactNode
  /** WebGL is off or failed: the list has to carry the whole view. */
  onUnavailable: () => void
}) {
  const stageRef = useRef<HTMLDivElement>(null)
  const hostRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const rendererRef = useRef<Renderer | null>(null)
  /**
   * Where the camera was, so a rebuild (after a forget, say) leaves you where
   * you were looking. Only the very first build of this canvas frames anew.
   */
  const cameraRef = useRef<{ x: number; y: number; ratio: number; angle: number } | null>(null)
  /**
   * A camera move asked for while the map is hidden (the List view on a
   * phone), done once it has a size again. Sigma measures a hidden canvas as
   * 1×1, and a frame computed from that zooms in a thousandfold.
   */
  const pending = useRef<(() => void) | null>(null)
  const whenVisible = (r: Renderer, fn: () => void) => {
    const host = hostRef.current
    if (!host || host.clientWidth <= 1) {
      pending.current = fn
      return
    }
    // Shown again in this same React update (List back to Map), the canvas
    // has its size, but Sigma has not heard yet: its resize observer fires
    // after this. Measured now, or the move is computed for a 1×1 canvas.
    if (r.getDimensions().width !== host.clientWidth) {
      r.resize()
      r.refresh()
    }
    fn()
  }
  const [failed, setFailed] = useState(false)
  const [ready, setReady] = useState(0)

  // Callbacks and the selection are read by Sigma's event handlers, which are
  // registered once per build; refs keep them current without a rebuild.
  const latest = useRef({ onSelect, selected, focusId, onUnavailable })
  latest.current = { onSelect, selected, focusId, onUnavailable }

  /** Pin the panel beside the selected node, or dock it on a narrow screen (CSS does that part). */
  const placePanel = useRef(() => {})
  placePanel.current = () => {
    const renderer = rendererRef.current
    const el = panelRef.current
    const stage = stageRef.current
    const sel = latest.current.selected
    if (!renderer || !el || !stage || !sel) return
    if (stage.clientWidth < 600) {
      el.style.transform = ''
      return
    }
    const id = nodeIdOf(sel)
    const graphology = renderer.getGraph()
    if (!graphology.hasNode(id)) return
    const a = graphology.getNodeAttributes(id) as BrainNodeAttributes
    const p = renderer.graphToViewport({ x: a.x, y: a.y })
    const halfH = renderer.scaleSize(a.size)
    const halfW = halfH * a.aspect
    const pw = el.offsetWidth
    const ph = el.offsetHeight
    const gap = 14
    const W = stage.clientWidth
    const H = stage.clientHeight
    // Beside the node, never on top of it: right if there is room, else left.
    let left = p.x + halfW + gap
    if (left + pw > W - 12) left = p.x - halfW - gap - pw
    left = Math.min(Math.max(12, left), W - pw - 12)
    const top = Math.min(Math.max(12, p.y - Math.min(ph / 2, halfH + 8)), H - ph - 12)
    el.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`
  }

  // Build the map. Runs again when the data changes, never on selection.
  useEffect(() => {
    const host = hostRef.current
    const stage = stageRef.current
    if (!host || !stage) return
    let cancelled = false
    let renderer: Renderer | null = null
    let observer: ResizeObserver | null = null

    const start = async () => {
      // The pill widths and the card text are measured in DM Sans. Measured
      // in the fallback face, every pill would come out the wrong width.
      try {
        await document.fonts?.ready
      } catch {}
      if (cancelled) return

      const palette = readPalette()
      // Laid out without the lone concepts, which are never drawn: placed
      // anyway, they would push the shared ones away from where they belong.
      // The layout gets the same measured widths the pills are drawn at, so a
      // long or wide label ("John Vincent Atanasoff") gets exactly its room.
      const pillWidth = makePillMeasure()
      const layout = layoutGraph(mapGraph(graph), { widthOf: (label) => pillWidth(label) })
      const data = buildBrainGraph(graph, layout, { highlight, highlightLabel, palette, pillWidth })
      const g = new Graph<BrainNodeAttributes, BrainEdgeAttributes>({ type: 'undirected', multi: false })
      for (const n of data.nodes) g.addNode(n.key, n.attributes)
      for (const e of data.edges) g.mergeEdge(e.source, e.target, e.attributes)

      const { drawCardLabel, drawCardHover } = makeCardDrawers(() => palette)
      let r: Renderer
      try {
        r = new Sigma(g, host, {
          nodeProgramClasses: { card: CardProgram },
          nodeHoverProgramClasses: { card: NoHoverProgram },
          defaultNodeType: 'card',
          defaultDrawNodeLabel: drawCardLabel,
          defaultDrawNodeHover: drawCardHover,
          // Cards grow and shrink with the zoom, as React Flow's did, instead
          // of staying a fixed number of pixels.
          itemSizesReference: 'positions',
          zoomToSizeRatioFunction: (ratio) => ratio,
          zIndex: true,
          renderEdgeLabels: false,
          enableEdgeEvents: false,
          minCameraRatio: 0.02,
          maxCameraRatio: 3,
          stagePadding: 40,
          // The list view hides the canvas on a phone; without this Sigma
          // throws on a container with no size.
          allowInvalidContainer: true,
        })
      } catch {
        // No WebGL (disabled, or a blocklisted driver). The list beside the
        // map still holds everything, so it takes over the view.
        setFailed(true)
        latest.current.onUnavailable()
        return
      }
      if (cancelled) {
        r.kill()
        return
      }
      renderer = r
      rendererRef.current = r

      // Sigma fits node CENTRES to the screen, so the cards on the edge came
      // out half cut off. The box it fits is widened by each node's own size.
      let [x0, x1, y0, y1] = [Infinity, -Infinity, Infinity, -Infinity]
      for (const { attributes: a } of data.nodes) {
        const hw = a.size * a.aspect
        x0 = Math.min(x0, a.x - hw)
        x1 = Math.max(x1, a.x + hw)
        y0 = Math.min(y0, a.y - a.size)
        y1 = Math.max(y1, a.y + a.size)
      }
      if (Number.isFinite(x0)) {
        r.setCustomBBox({ x: [x0, x1], y: [y0, y1] })
        // setCustomBBox only schedules a render. The frame below measures the
        // scale, so the new box has to be in effect first.
        r.refresh()
      }

      r.on('clickNode', ({ node }) => latest.current.onSelect(selectionOf(node)))
      r.on('clickStage', () => latest.current.onSelect(null))
      r.on('enterNode', () => host.classList.add('is-pointing'))
      r.on('leaveNode', () => host.classList.remove('is-pointing'))
      /**
       * The lines fade with the concepts they lead to. A pill fades on the
       * GPU at no cost; Sigma's own line program cannot, so the lines step
       * through five levels instead (hidden, 1/4, 1/2, 3/4, full). A step is
       * one batch of attribute writes, and a zoom from close in to far out
       * crosses at most four of them, so this costs nothing while you pan.
       * Hidden, Sigma skips the lines entirely. They are built at full.
       */
      const lines = g.edges()
      let edgeStep = 4
      const stepLines = () => {
        const step = Math.round(fadeAt(r.scaleSize(1)) * 4)
        if (step === edgeStep || lines.length === 0) return
        edgeStep = step
        const look =
          step === 0 ? { hidden: true } : { hidden: false, color: fadedColor(palette.lineStrong, step / 4) }
        for (const e of lines) g.mergeEdgeAttributes(e, look)
      }

      r.on('afterRender', () => {
        stepLines()
        // The dot grid is CSS behind the canvas, moved and scaled with the camera.
        const o = r.graphToViewport({ x: 0, y: 0 })
        const gap = r.scaleSize(DOT_GAP)
        stage.style.setProperty('--dot-gap', `${gap}px`)
        stage.style.setProperty('--dot-x', `${o.x % gap}px`)
        stage.style.setProperty('--dot-y', `${o.y % gap}px`)
        stage.dataset.dots = gap >= 9 ? 'on' : 'off'
        placePanel.current()
      })

      observer = new ResizeObserver(() => {
        r.resize()
        r.refresh()
        if (pending.current && host.clientWidth > 1) {
          const run = pending.current
          pending.current = null
          run()
        }
      })
      observer.observe(host)

      const kept = cameraRef.current
      whenVisible(r, () => {
        if (kept) {
          r.getCamera().setState(kept)
          return
        }
        // A fresh frame: the open chat and what it reaches, or everything.
        const focus = latest.current.focusId
        const ids = focus && g.hasNode(chatNodeId(focus)) ? focusSet(g, chatNodeId(focus)) : null
        frame(r, ids, false)
      })
      setReady((n) => n + 1)
    }
    void start()

    return () => {
      cancelled = true
      observer?.disconnect()
      pending.current = null
      if (renderer) {
        cameraRef.current = renderer.getCamera().getState()
        renderer.kill()
      }
      if (rendererRef.current === renderer) rendererRef.current = null
    }
  }, [graph, highlight, highlightLabel])

  // Mark the selected node with the persistent ring, and bring it into view
  // when it was picked from the list.
  useEffect(() => {
    const renderer = rendererRef.current
    if (!renderer) return
    const g = renderer.getGraph()
    const id = selected ? nodeIdOf(selected) : null
    g.forEachNode((node, a) => {
      const on = node === id
      if (a.highlighted !== on) g.setNodeAttribute(node, 'highlighted', on)
    })
    if (id && g.hasNode(id) && selectedFrom === 'list') {
      whenVisible(renderer, () => {
        const d = renderer.getNodeDisplayData(id)
        if (!d) return
        const camera = renderer.getCamera()
        // Close enough to read it; never further out than you already were.
        const ratio = Math.min(camera.ratio, unitAtRatioOne(renderer) / 0.9)
        const target = { x: d.x, y: d.y, ratio, angle: 0 }
        // On a narrow map the panel is a sheet over the bottom half, and a
        // node centred on the screen sat right under it. Centre it in the
        // part above the sheet instead: move the camera down by half the
        // sheet, so the node rises by that much.
        const stage = stageRef.current
        const sheet = panelRef.current?.offsetHeight ?? 0
        if (stage && stage.clientWidth < 600 && sheet > 0) {
          const mid = { x: stage.clientWidth / 2, y: stage.clientHeight / 2 }
          const a = renderer.viewportToFramedGraph(mid, { cameraState: target })
          const b = renderer.viewportToFramedGraph({ x: mid.x, y: mid.y + sheet / 2 }, { cameraState: target })
          target.y += b.y - a.y
        }
        if (reducedMotion()) camera.setState(target)
        else void camera.animate(target, { duration: 380, easing: 'quadraticOut' })
      })
    }
    renderer.refresh()
    placePanel.current()
  }, [selected, selectedFrom, ready])

  const zoom = (how: 'in' | 'out' | 'fit') => {
    const renderer = rendererRef.current
    if (!renderer) return
    const camera = renderer.getCamera()
    const duration = reducedMotion() ? 0 : 220
    if (how === 'in') void camera.animatedZoom({ duration })
    else if (how === 'out') void camera.animatedUnzoom({ duration })
    else frame(renderer, null, true)
  }

  return (
    <div className="brain-stage" ref={stageRef} data-dots="on">
      <div
        className="brain-host"
        ref={hostRef}
        // The canvas is a picture to everyone who cannot see it; the list
        // beside it is the readable version, and says so.
        role="img"
        aria-label="Map of your conversations and the concepts they share. The list beside it has the same content."
      />
      {failed && (
        <div className="brain-fallback">
          <p>
            This browser has WebGL turned off, so the map cannot be drawn. Every chat and
            shared concept is in the list.
          </p>
        </div>
      )}
      {!failed && (
        <div className="brain-zoom" role="group" aria-label="Zoom the map">
          <button type="button" onClick={() => zoom('in')} aria-label="Zoom in" title="Zoom in">
            <Plus size={15} aria-hidden="true" />
          </button>
          <button type="button" onClick={() => zoom('out')} aria-label="Zoom out" title="Zoom out">
            <Minus size={15} aria-hidden="true" />
          </button>
          <button type="button" onClick={() => zoom('fit')} aria-label="Show the whole map" title="Show the whole map">
            <Maximize size={14} aria-hidden="true" />
          </button>
        </div>
      )}
      {selected && panel && (
        <div className="brain-panel" ref={panelRef}>
          {panel}
        </div>
      )}
    </div>
  )
}

/**
 * What the first frame shows when a chat is open: the chat, the concepts it
 * holds on the map, and every other chat that holds one of them. That set IS
 * the Brain's claim ("your words reached these conversations by
 * themselves"), so it is exactly what the view should contain.
 *
 * On a phone the wide set is nearly the whole graph again, so there it is just
 * the chat and its own concepts, with the lines running off-screen to say
 * there is more.
 */
function focusSet(g: Graph<BrainNodeAttributes, BrainEdgeAttributes>, chat: string): string[] {
  const near = [chat, ...g.neighbors(chat)]
  if (window.innerWidth < 760) return near
  const wide = new Set(near)
  for (const concept of g.neighbors(chat)) for (const other of g.neighbors(concept)) wide.add(other)
  return [...wide]
}
