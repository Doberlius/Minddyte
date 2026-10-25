import type { NodeLabelDrawingFunction } from 'sigma/rendering'
import type { BrainNodeAttributes, BrainPalette } from './brainGraph'
import { CHAT_SIZE, PILL_SIZE, fadeAt } from './brainGraph'
import { CARD_SIZE } from '@/lib/graph-layout'

/**
 * The words on the map: everything CardProgram cannot draw, written on
 * Sigma's label canvas in screen pixels.
 *
 * These copy the old React Flow nodes measure for measure (padding, sizes,
 * weights, colours), so the switch to WebGL does not change how a card reads:
 *
 *   chat card   speech-bubble icon + "CONVERSATION" eyebrow, a two-line title,
 *               "18 messages", and "+N concepts" for the concepts only this
 *               chat has (they are never drawn; see mapGraph)
 *   pill        a shared concept: white label and a count badge, on violet,
 *               fading in with the zoom like its shape on the GPU
 *
 * Everything is multiplied by `k`, how many screen pixels one unit of the card
 * is at the current zoom, so the text grows and shrinks with its card. Below a
 * readable size the text is skipped altogether: an unreadable smear costs as
 * much to draw as a readable label, and zoomed out it is the shape that
 * matters.
 */

const UI_FONT = '"DM Sans", system-ui, sans-serif'

/** The lucide MessageSquare outline the app's cards wear, on its 24-unit grid. */
const BUBBLE_PATH =
  'M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z'

/** Below this many screen pixels a title is a gray smear, not text. */
const MIN_TEXT_PX = 5

/** White text on violet; .92 keeps the quieter lines legible (see the old ChatNode). */
const ON_VIOLET = '#FFFFFF'
const ON_VIOLET_QUIET = 'rgba(255,255,255,.92)'
const BADGE_FILL = 'rgba(255,255,255,.26)'

type CardData = Parameters<NodeLabelDrawingFunction>[1] & Partial<BrainNodeAttributes>

/**
 * Canvas text has letter-spacing only in newer browsers. Where it is missing
 * the eyebrow is simply set tight, which is still legible.
 */
function track(ctx: CanvasRenderingContext2D, px: number) {
  if ('letterSpacing' in ctx) (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${px}px`
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r)
  else ctx.rect(x, y, w, h)
}

/**
 * Split a title into at most `lines` lines that fit `maxW`, ending the last
 * with an ellipsis when words were left over. The same job the old card did
 * with -webkit-line-clamp, which a canvas does not have.
 */
export function wrapLines(
  measure: (text: string) => number,
  text: string,
  maxW: number,
  lines: number,
): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  const out: string[] = []
  let cur = ''
  let leftover = false
  for (const word of words) {
    const next = cur ? `${cur} ${word}` : word
    // The first word of a line always goes on it, even if too long; it is cut below.
    if (!cur || measure(next) <= maxW) {
      cur = next
      continue
    }
    out.push(cur)
    cur = word
    if (out.length === lines) {
      leftover = true
      break
    }
  }
  if (!leftover && cur) out.push(cur)
  if (out.length === 0) return out

  // Something did not fit: words left over, or one word wider than the line.
  const last = out.length - 1
  if (leftover || measure(out[last]) > maxW) {
    let line = out[last]
    while (line.length > 1 && measure(`${line}…`) > maxW) line = line.slice(0, -1)
    out[last] = `${line.trimEnd()}…`
  }
  return out
}

/**
 * The drawn width of a pill at zoom 1, measured with the same fonts the label
 * uses so the box fits its text exactly. Fonts must have loaded first, or this
 * measures the fallback face.
 */
export function makePillMeasure(): (label: string) => number {
  const ctx = document.createElement('canvas').getContext('2d')
  if (!ctx) return (label) => label.length * 7 + 52
  return (label) => {
    ctx.font = `600 12.5px ${UI_FONT}`
    const tw = ctx.measureText(label).width
    ctx.font = `600 10.5px ${UI_FONT}`
    return Math.ceil(14 + tw + 8 + badgeWidth(ctx, '99') + 7)
  }
}

/** The count badge: at least 19px, or its digits plus 6px a side. `ctx.font` must already be the badge font. */
function badgeWidth(ctx: CanvasRenderingContext2D, digits: string) {
  return Math.max(19, ctx.measureText(digits).width + 12)
}

export function makeCardDrawers(palette: () => BrainPalette) {
  const bubble = typeof Path2D === 'function' ? new Path2D(BUBBLE_PATH) : null

  function drawChat(ctx: CanvasRenderingContext2D, d: CardData) {
    const p = palette()
    const k = d.size / CHAT_SIZE
    if (13 * k < MIN_TEXT_PX) return

    const w = CARD_SIZE.w * k
    const h = CARD_SIZE.h * k
    const x0 = d.x - w / 2
    const y0 = d.y - h / 2
    const padX = 15 * k
    const mine = !!d.mine
    const quiet = mine ? ON_VIOLET_QUIET : p.ink3

    ctx.save()
    ctx.textBaseline = 'alphabetic'

    // Eyebrow: a 10px icon, then the label, on one line 12px down.
    if (bubble) {
      ctx.save()
      ctx.translate(x0 + padX, y0 + 12.5 * k)
      ctx.scale((10 * k) / 24, (10 * k) / 24)
      ctx.strokeStyle = quiet
      ctx.lineWidth = 2
      ctx.lineJoin = 'round'
      ctx.stroke(bubble)
      ctx.restore()
    }
    ctx.fillStyle = quiet
    ctx.font = `600 ${10 * k}px ${UI_FONT}`
    track(ctx, 0.85 * k)
    const eyebrow = (mine ? d.mineLabel ?? '' : 'conversation').toUpperCase()
    ctx.fillText(eyebrow, x0 + padX + 16 * k, y0 + 21.5 * k)
    track(ctx, -0.13 * k)

    // Title: two lines at most, 13px semibold on an 18px line.
    ctx.fillStyle = mine ? ON_VIOLET : p.ink
    ctx.font = `600 ${13 * k}px ${UI_FONT}`
    const title = d.truncated ? `${d.label}…` : d.label ?? ''
    const lines = wrapLines((t) => ctx.measureText(t).width, title, w - padX * 2, 2)
    lines.forEach((line, i) => ctx.fillText(line, x0 + padX, y0 + 44 * k + i * 18.2 * k))

    // Count line, pinned to the bottom of the card.
    track(ctx, 0)
    const baseY = y0 + h - 14 * k
    const count = `${d.messages ?? 0} message${d.messages === 1 ? '' : 's'}`
    ctx.font = `400 ${10.5 * k}px ${UI_FONT}`
    ctx.fillStyle = quiet
    ctx.fillText(count, x0 + padX, baseY)
    // The count stands in for the lone concepts while they are too far away
    // to draw, so it fades out exactly as they fade in.
    // The concepts only this chat has are never drawn; this count stands in.
    const extra = d.extra ?? 0
    if (extra > 0) {
      const sep = ' · '
      let x = x0 + padX + ctx.measureText(count).width
      ctx.fillText(sep, x, baseY)
      x += ctx.measureText(sep).width
      ctx.font = `600 ${10.5 * k}px ${UI_FONT}`
      ctx.fillStyle = mine ? ON_VIOLET : p.violet
      ctx.fillText(`+${extra.toLocaleString('en-US')} concept${extra === 1 ? '' : 's'}`, x, baseY)
    }
    ctx.restore()
  }

  function drawPill(ctx: CanvasRenderingContext2D, d: CardData) {
    const k = d.size / PILL_SIZE
    if (11.5 * k < MIN_TEXT_PX + 1) return

    // The concept fades in with the zoom, in step with its pill on the GPU.
    const fade = d.fadeTo ? fadeAt(k, d.fadeFrom, d.fadeTo) : 1
    if (fade <= 0.01) return

    const h = d.size * 2
    const w = h * (d.aspect ?? 1)
    const x0 = d.x - w / 2

    ctx.save()
    ctx.globalAlpha = fade
    ctx.textBaseline = 'middle'
    ctx.font = `600 ${12.5 * k}px ${UI_FONT}`
    ctx.fillStyle = ON_VIOLET
    ctx.fillText(d.label ?? '', x0 + 14 * k, d.y + 0.5 * k)

    ctx.font = `600 ${10.5 * k}px ${UI_FONT}`
    const digits = String(d.count ?? '')
    const bw = badgeWidth(ctx, digits) // measured at the scaled font, so already in screen px
    const bh = 17 * k
    const bx = x0 + w - 7 * k - bw
    ctx.fillStyle = BADGE_FILL
    roundRect(ctx, bx, d.y - bh / 2, bw, bh, bh / 2)
    ctx.fill()
    ctx.fillStyle = ON_VIOLET
    ctx.textAlign = 'center'
    ctx.fillText(digits, bx + bw / 2, d.y + 0.5 * k)
    ctx.restore()
  }

  const drawCardLabel: NodeLabelDrawingFunction = (ctx, data) => {
    const d = data as CardData
    if (d.kind === 'chat') drawChat(ctx, d)
    else drawPill(ctx, d)
  }

  /**
   * The ring around a hovered or selected node, 3px outside it. Drawn on
   * Sigma's hover canvas, above the labels, so it never covers text.
   */
  const drawCardHover: NodeLabelDrawingFunction = (ctx, data) => {
    const d = data as CardData
    const p = palette()
    let w: number
    let h: number
    let r: number
    if (d.kind === 'chat') {
      const k = d.size / CHAT_SIZE
      w = CARD_SIZE.w * k
      h = CARD_SIZE.h * k
      r = 10 * k
    } else {
      h = d.size * 2
      w = h * (d.aspect ?? 1)
      r = h / 2
    }
    // A selected lone concept, zoomed away from, has faded out: so does its ring.
    const fade = d.fadeTo ? fadeAt(d.size / PILL_SIZE, d.fadeFrom, d.fadeTo) : 1
    if (fade <= 0.01) return
    ctx.save()
    ctx.globalAlpha = fade
    ctx.strokeStyle = p.violet
    ctx.lineWidth = d.highlighted ? 2.5 : 2
    // A filled card already IS violet; its ring sits a little further out so it reads as a ring.
    const gap = d.mine || d.kind === 'shared' ? 4 : 3
    roundRect(ctx, d.x - w / 2 - gap, d.y - h / 2 - gap, w + gap * 2, h + gap * 2, r + gap)
    ctx.stroke()
    ctx.restore()
  }

  return { drawCardLabel, drawCardHover }
}
