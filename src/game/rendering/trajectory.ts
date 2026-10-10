import { hermite, newSample, SAMPLE_STRIDE } from '../physics/interpolate'
import type { PropagationResult } from '../physics/propagate'
import type { Camera } from './camera'
import { arrowHead, type Ctx } from './draw'
import { COLORS, withAlpha } from './palette'

export type LegStyle = 'inbound' | 'assist' | 'outbound' | 'danger'

const LEG_COLOR: Record<LegStyle, string> = {
  inbound: COLORS.cyan,
  assist: COLORS.amber,
  outbound: COLORS.gold,
  danger: COLORS.red,
}

export const legColor = (s: LegStyle): string => LEG_COLOR[s]

/** Screen-space polyline of a trajectory, reused for drawing and hit-testing. */
export interface ScreenPath {
  n: number
  xs: Float32Array
  ys: Float32Array
  ts: Float64Array
  styles: LegStyle[]
}

export function legStyleAt(result: PropagationResult, t: number): LegStyle {
  if (result.endReason === 'collision') {
    const start = result.samples[0]
    const lastBurn = result.burns.reduce((m, b) => (b.applied ? Math.max(m, b.t) : m), start)
    const tail = Math.max(lastBurn, result.endTime - 0.14 * (result.endTime - start))
    if (t >= tail) return 'danger'
  }
  let after = false
  for (const f of result.flybys) {
    if (t >= f.tIn && t <= f.tOut) return 'assist'
    if (t > f.tOut) after = true
  }
  return after ? 'outbound' : 'inbound'
}

export function buildScreenPath(result: PropagationResult, camera: Camera, tMax = Infinity): ScreenPath {
  return buildScreenPathFrom(result.samples, result.sampleCount, camera, (t) => legStyleAt(result, t), -Infinity, tMax)
}

/** Screen polyline of any sampled path; `styleAt` colours it, [tMin, tMax] crops it. */
export function buildScreenPathFrom(
  s: Float64Array,
  n0: number,
  camera: Camera,
  styleAt: (t: number) => LegStyle,
  tMin = -Infinity,
  tMax = Infinity,
): ScreenPath {
  let cap = n0 * 2 + 16
  let xs = new Float32Array(cap)
  let ys = new Float32Array(cap)
  let ts = new Float64Array(cap)
  const styles: LegStyle[] = []
  let n = 0
  let lx = NaN
  let ly = NaN
  const tmp = newSample()

  const push = (t: number, x: number, y: number, style: LegStyle) => {
    if (n >= cap) {
      cap *= 2
      const nx = new Float32Array(cap)
      const ny = new Float32Array(cap)
      const nt = new Float64Array(cap)
      nx.set(xs)
      ny.set(ys)
      nt.set(ts)
      xs = nx
      ys = ny
      ts = nt
    }
    xs[n] = x
    ys[n] = y
    ts[n] = t
    styles[n] = style
    lx = x
    ly = y
    n++
  }

  for (let i = 0; i < n0; i++) {
    const o = i * SAMPLE_STRIDE
    const t = s[o]
    if (t > tMax) break
    if (t < tMin) continue
    const x = camera.sx(s[o + 1])
    const y = camera.sy(s[o + 2])
    const style = styleAt(t)
    const last = i === n0 - 1
    if (n > 0 && i > 0) {
      // long chords on curved arcs (zoomed in): fill in with the cubic Hermite through both samples
      const p = o - SAMPLE_STRIDE
      const chord = Math.hypot(x - lx, y - ly)
      if (chord > 10 && t > s[p]) {
        const k = Math.min(24, Math.ceil(chord / 7))
        for (let j = 1; j < k; j++) {
          const tj = s[p] + ((t - s[p]) * j) / k
          if (tj > tMax) break
          hermite(s[p], s[p + 1], s[p + 2], s[p + 3], s[p + 4], t, s[o + 1], s[o + 2], s[o + 3], s[o + 4], tj, tmp)
          push(tj, camera.sx(tmp.x), camera.sy(tmp.y), styleAt(tj))
        }
      }
    }
    if (n > 0 && !last && style === styles[n - 1] && Math.abs(x - lx) + Math.abs(y - ly) < 1.5) continue
    push(t, x, y, style)
  }
  return { n, xs, ys, ts, styles }
}

export interface PathStyle {
  /** dashed and flowing (forecast) vs solid (flown) */
  dashed: boolean
  alpha: number
  width: number
  arrows: boolean
  dashOffset: number
  glow: boolean
  /** draw everything in one colour (ghost path) */
  mono?: string
}

/** Draws [from, to) of the screen path, split into colour legs. */
export function drawPath(ctx: Ctx, path: ScreenPath, style: PathStyle, from = 0, to = path.n): void {
  to = Math.min(to, path.n)
  from = Math.max(0, from)
  if (to - from < 2) return
  ctx.save()
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  let i = from
  while (i < to - 1) {
    const legStyle = path.styles[i]
    let j = i + 1
    while (j < to - 1 && path.styles[j] === legStyle) j++
    const color = style.mono ?? LEG_COLOR[legStyle]
    const strokeLeg = () => {
      ctx.beginPath()
      ctx.moveTo(path.xs[i], path.ys[i])
      for (let k = i + 1; k <= j; k++) ctx.lineTo(path.xs[k], path.ys[k])
      ctx.stroke()
    }
    if (style.glow) {
      ctx.setLineDash([])
      ctx.strokeStyle = withAlpha(color, 0.13 * style.alpha)
      ctx.lineWidth = style.width + 6
      strokeLeg()
    }
    ctx.strokeStyle = withAlpha(color, style.alpha)
    ctx.lineWidth = style.width
    if (style.dashed) {
      ctx.setLineDash([9, 8])
      ctx.lineDashOffset = style.dashOffset
    } else {
      ctx.setLineDash([])
    }
    strokeLeg()
    i = j
  }
  ctx.setLineDash([])

  if (style.arrows) {
    // chevrons every ~130 px along the path, pointing in the direction of motion
    let acc = 65
    for (let k = from + 1; k < to; k++) {
      const dx = path.xs[k] - path.xs[k - 1]
      const dy = path.ys[k] - path.ys[k - 1]
      const seg = Math.hypot(dx, dy)
      acc += seg
      if (acc >= 130 && seg > 0.01) {
        acc = 0
        const color = style.mono ?? LEG_COLOR[path.styles[k]]
        arrowHead(ctx, path.xs[k], path.ys[k], Math.atan2(dy, dx), 10, withAlpha(color, Math.min(1, style.alpha + 0.1)))
      }
    }
  }
  ctx.restore()
}

/** Index of the last path point with time ≤ t. */
export function pathIndexAt(path: ScreenPath, t: number): number {
  let lo = 0
  let hi = path.n - 1
  if (hi < 0) return 0
  if (t >= path.ts[hi]) return hi
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (path.ts[mid] <= t) lo = mid
    else hi = mid
  }
  return lo
}

/** Nearest point of the path to (x, y): returns its time and pixel distance. */
export function nearestOnPath(path: ScreenPath, x: number, y: number): { t: number; d: number; px: number; py: number } | null {
  let best: { t: number; d: number; px: number; py: number } | null = null
  for (let k = 1; k < path.n; k++) {
    const ax = path.xs[k - 1]
    const ay = path.ys[k - 1]
    const bx = path.xs[k]
    const by = path.ys[k]
    const dx = bx - ax
    const dy = by - ay
    const len2 = dx * dx + dy * dy
    const u = len2 > 0 ? Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy) / len2)) : 0
    const px = ax + u * dx
    const py = ay + u * dy
    const d = Math.hypot(x - px, y - py)
    if (!best || d < best.d) best = { t: path.ts[k - 1] + u * (path.ts[k] - path.ts[k - 1]), d, px, py }
  }
  return best
}
