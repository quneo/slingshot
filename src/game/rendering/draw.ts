import { COLORS, FONT, withAlpha } from './palette'

export type Ctx = CanvasRenderingContext2D

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export function roundRectPath(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}

/** Keeps callouts from piling on top of each other and off the HUD. */
export class LabelBoard {
  private rects: Rect[] = []

  constructor(private bounds: Rect) {}

  reset(bounds: Rect): void {
    this.bounds = bounds
    this.rects = []
  }

  reserve(r: Rect): void {
    this.rects.push(r)
  }

  fits(r: Rect): boolean {
    const b = this.bounds
    if (r.x < b.x || r.y < b.y || r.x + r.w > b.x + b.w || r.y + r.h > b.y + b.h) return false
    return !this.rects.some((o) => r.x < o.x + o.w && r.x + r.w > o.x && r.y < o.y + o.h && r.y + r.h > o.y)
  }
}

export function setFont(ctx: Ctx, size: number, weight = 600): void {
  ctx.font = `${weight} ${size}px ${FONT}`
}

/** Text with a dark halo so it reads over planets and paths. */
export function haloText(ctx: Ctx, text: string, x: number, y: number, color: string, alpha = 1): void {
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.lineJoin = 'round'
  ctx.lineWidth = 4
  ctx.strokeStyle = 'rgba(5, 10, 24, 0.85)'
  ctx.strokeText(text, x, y)
  ctx.fillStyle = color
  ctx.fillText(text, x, y)
  ctx.restore()
}

export interface CalloutOptions {
  color: string
  lines: string[]
  /** first line is drawn larger/bolder */
  title?: boolean
  fill?: string
  board?: LabelBoard
  /** preferred distance from the anchor */
  distance?: number
  alpha?: number
}

/** Rounded label box with a leader line to an anchor point, as in the concept art. Returns the box rect. */
export function callout(ctx: Ctx, ax: number, ay: number, opts: CalloutOptions): Rect | null {
  const { color, lines } = opts
  const dist = opts.distance ?? 34
  const padX = 10
  const lineH = 17
  ctx.save()
  ctx.globalAlpha = opts.alpha ?? 1
  const widths = lines.map((l, i) => {
    setFont(ctx, i === 0 && opts.title ? 13.5 : 12.5, i === 0 ? 700 : 600)
    return ctx.measureText(l).width
  })
  const w = Math.ceil(Math.max(...widths)) + padX * 2
  const h = lines.length * lineH + 10
  const candidates: [number, number][] = [
    [dist * 0.6, -dist - h],
    [-dist * 0.6 - w, -dist - h],
    [dist * 0.6, dist],
    [-dist * 0.6 - w, dist],
    [dist, -h / 2],
    [-dist - w, -h / 2],
  ]
  let rect: Rect | null = null
  for (const [dx, dy] of candidates) {
    const r = { x: ax + dx, y: ay + dy, w, h }
    if (!opts.board || opts.board.fits(r)) {
      rect = r
      break
    }
  }
  if (!rect) {
    ctx.restore()
    return null
  }
  opts.board?.reserve(rect)

  // leader line from the nearest box edge point to the anchor
  const cx = Math.min(Math.max(ax, rect.x), rect.x + rect.w)
  const cy = Math.min(Math.max(ay, rect.y), rect.y + rect.h)
  ctx.strokeStyle = withAlpha(color, 0.85)
  ctx.lineWidth = 1.25
  ctx.beginPath()
  ctx.moveTo(cx, cy)
  ctx.lineTo(ax, ay)
  ctx.stroke()

  roundRectPath(ctx, rect.x, rect.y, rect.w, rect.h, 8)
  ctx.fillStyle = opts.fill ?? 'rgba(10, 18, 36, 0.86)'
  ctx.fill()
  ctx.strokeStyle = color
  ctx.lineWidth = 1.25
  ctx.stroke()

  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  lines.forEach((l, i) => {
    setFont(ctx, i === 0 && opts.title ? 13.5 : 12.5, i === 0 ? 700 : 600)
    ctx.fillStyle = i === 0 ? color : COLORS.text2
    ctx.fillText(l, rect!.x + padX, rect!.y + 5 + lineH * (i + 0.5))
  })
  ctx.restore()
  return rect
}

export function arrowHead(ctx: Ctx, x: number, y: number, angle: number, size: number, color: string): void {
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(angle)
  ctx.beginPath()
  ctx.moveTo(size * 0.55, 0)
  ctx.lineTo(-size * 0.45, size * 0.48)
  ctx.lineTo(-size * 0.2, 0)
  ctx.lineTo(-size * 0.45, -size * 0.48)
  ctx.closePath()
  ctx.fillStyle = color
  ctx.fill()
  ctx.restore()
}

export function ring(ctx: Ctx, x: number, y: number, r: number, color: string, width = 2, fill?: string): void {
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  if (fill) {
    ctx.fillStyle = fill
    ctx.fill()
  }
  ctx.strokeStyle = color
  ctx.lineWidth = width
  ctx.stroke()
}

/**
 * Planet sprite cut to a disc, with a terminator shadow facing away from the star.
 * `lightAngle` is the screen-space angle from the planet towards the star.
 */
export function drawPlanetDisc(
  ctx: Ctx,
  img: HTMLImageElement,
  x: number,
  y: number,
  r: number,
  lightAngle: number | null,
  glowColor: string,
  alpha = 1,
): void {
  ctx.save()
  ctx.globalAlpha = alpha
  // soft atmospheric halo
  const halo = ctx.createRadialGradient(x, y, r * 0.9, x, y, r * 1.45)
  halo.addColorStop(0, withAlpha(glowColor, 0.22))
  halo.addColorStop(1, withAlpha(glowColor, 0))
  ctx.fillStyle = halo
  ctx.beginPath()
  ctx.arc(x, y, r * 1.45, 0, Math.PI * 2)
  ctx.fill()

  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.clip()
  ctx.drawImage(img, x - r, y - r, r * 2, r * 2)
  if (lightAngle !== null) {
    const lx = x + Math.cos(lightAngle) * r * 0.62
    const ly = y + Math.sin(lightAngle) * r * 0.62
    const shade = ctx.createRadialGradient(lx, ly, r * 0.15, lx, ly, r * 2.05)
    shade.addColorStop(0, 'rgba(4, 8, 20, 0)')
    shade.addColorStop(0.42, 'rgba(4, 8, 20, 0.05)')
    shade.addColorStop(0.7, 'rgba(4, 8, 20, 0.62)')
    shade.addColorStop(1, 'rgba(4, 8, 20, 0.94)')
    ctx.fillStyle = shade
    ctx.fillRect(x - r, y - r, r * 2, r * 2)
  }
  ctx.restore()

  if (lightAngle !== null && r > 6) {
    // thin lit rim on the star side
    ctx.save()
    ctx.globalAlpha = alpha * 0.55
    ctx.strokeStyle = withAlpha(glowColor, 0.9)
    ctx.lineWidth = Math.max(1, r * 0.035)
    ctx.beginPath()
    ctx.arc(x, y, r - ctx.lineWidth / 2, lightAngle - 1.1, lightAngle + 1.1)
    ctx.stroke()
    ctx.restore()
  }
}

/** Ringed planet: back half of the rings, the disc, then the front half. */
export function drawRingedPlanet(
  ctx: Ctx,
  img: HTMLImageElement,
  rings: HTMLImageElement,
  x: number,
  y: number,
  r: number,
  lightAngle: number | null,
  glowColor: string,
  alpha = 1,
): void {
  const tilt = -0.42
  const squash = 0.34
  const ringR = r * 2.25
  const drawHalf = (front: boolean) => {
    ctx.save()
    ctx.globalAlpha = alpha * 0.92
    ctx.translate(x, y)
    ctx.rotate(tilt)
    ctx.scale(1, squash)
    ctx.beginPath()
    if (front) ctx.rect(-ringR, 0, ringR * 2, ringR)
    else ctx.rect(-ringR, -ringR, ringR * 2, ringR)
    ctx.clip()
    ctx.drawImage(rings, -ringR, -ringR, ringR * 2, ringR * 2)
    ctx.restore()
  }
  drawHalf(false)
  drawPlanetDisc(ctx, img, x, y, r, lightAngle, glowColor, alpha)
  drawHalf(true)
}

export function drawStar(
  ctx: Ctx,
  surface: HTMLImageElement,
  glow: HTMLImageElement,
  x: number,
  y: number,
  r: number,
  timeSec: number,
  calm: boolean,
): void {
  const pulse = calm ? 1 : 1 + Math.sin(timeSec * 0.9) * 0.025
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  const gr = r * 2.4 * pulse
  const corona = ctx.createRadialGradient(x, y, r * 0.8, x, y, r * 3.8)
  corona.addColorStop(0, 'rgba(255, 170, 70, 0.32)')
  corona.addColorStop(0.4, 'rgba(255, 120, 40, 0.08)')
  corona.addColorStop(1, 'rgba(255, 100, 30, 0)')
  ctx.fillStyle = corona
  ctx.beginPath()
  ctx.arc(x, y, r * 3.8, 0, Math.PI * 2)
  ctx.fill()
  ctx.globalAlpha = 0.8
  ctx.drawImage(glow, x - gr, y - gr, gr * 2, gr * 2)
  ctx.restore()

  ctx.save()
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.clip()
  const spin = calm ? 0 : timeSec * 0.02
  ctx.translate(x, y)
  ctx.rotate(spin)
  ctx.drawImage(surface, -r * 1.02, -r * 1.02, r * 2.04, r * 2.04)
  ctx.restore()
}

export function drawShip(
  ctx: Ctx,
  img: HTMLImageElement,
  x: number,
  y: number,
  angle: number,
  length: number,
  thrust: number,
  timeSec: number,
): void {
  const h = (length * img.height) / img.width
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(angle)
  if (thrust > 0.01) {
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    const flick = 0.85 + Math.sin(timeSec * 40) * 0.15
    const fl = length * (0.55 + 0.6 * thrust) * flick
    const g = ctx.createLinearGradient(-length * 0.45, 0, -length * 0.45 - fl, 0)
    g.addColorStop(0, `rgba(190, 240, 255, ${0.95 * thrust})`)
    g.addColorStop(0.35, `rgba(77, 207, 245, ${0.7 * thrust})`)
    g.addColorStop(1, 'rgba(77, 207, 245, 0)')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.moveTo(-length * 0.42, -h * 0.16)
    ctx.quadraticCurveTo(-length * 0.45 - fl * 0.6, 0, -length * 0.42, h * 0.16)
    ctx.closePath()
    ctx.fill()
    ctx.beginPath()
    ctx.moveTo(-length * 0.42, -h * 0.1)
    ctx.lineTo(-length * 0.45 - fl, 0)
    ctx.lineTo(-length * 0.42, h * 0.1)
    ctx.fill()
    ctx.restore()
  }
  ctx.drawImage(img, -length / 2, -h / 2, length, h)
  ctx.restore()
}
