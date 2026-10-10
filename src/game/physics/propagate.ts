import type { StateVector } from './ephemeris'
import { keplerStateInto } from './ephemeris'
import { DormandPrince, nextStepFactor, type Tolerance } from './integrators'
import { hermite, newSample, SAMPLE_STRIDE, type ShipSample } from './interpolate'
import { shipDerivative, type PhysicsSystem } from './system'

/** Impulsive burn in the ship's local frame, relative to its heliocentric velocity at time t. */
export interface LocalBurn {
  t: number
  /** along the velocity */
  prograde: number
  /** perpendicular to the velocity, positive = away from the star for a prograde orbit */
  radial: number
}

export interface TargetSpec {
  bodyIndex: number
  /** arrival when the distance to the body centre ≤ zoneRadius */
  zoneRadius: number
  /** rendezvous goal: arrival additionally needs |v_rel| ≤ maxRelSpeed; null for a flyby goal */
  maxRelSpeed: number | null
}

export interface PropagationInput {
  system: PhysicsSystem
  t0: number
  state0: StateVector
  burns: readonly LocalBurn[]
  tEnd: number
  target: TargetSpec | null
  /** the ship is lost once it is farther than this from the star */
  escapeRadius: number
  /**
   * Body the ship departs from (patched-conic launch): the ship starts at its centre with the planet's velocity
   * plus the launch Δv. Until the ship is farther than `departureRadius(body)` this body neither attracts it nor
   * collides with it; after release it is an ordinary body. Releasing late only removes energy (the ship then
   * still has to climb out of the remaining potential), so the simplification can never create free Δv.
   */
  departureBodyIndex: number | null
  tolerance?: Tolerance
  maxStep?: number
  maxSamples?: number
}

export type EndReason = 'arrived' | 'collision' | 'escaped' | 'timeout' | 'step-limit'

export interface ApproachPoint {
  t: number
  /** distance from the ship to the body centre */
  distance: number
  relSpeed: number
  /** ship position */
  x: number
  y: number
}

export interface FlybyRecord extends ApproachPoint {
  bodyIndex: number
  tIn: number
  tOut: number
  /** heliocentric speed on entering / leaving the influence radius */
  speedIn: number
  speedOut: number
  /** heliocentric specific orbital energy (star only) on entering / leaving */
  energyIn: number
  energyOut: number
  /** |v_out − v_in − Σ burns inside|: how much the planet's gravity alone changed the heliocentric velocity */
  deltaV: number
  vxIn: number
  vyIn: number
  /** energy and velocity added by engine burns fired inside the sphere (excluded from the gravity figures) */
  burnEnergy: number
  burnDvx: number
  burnDvy: number
  /** false when the trajectory ended inside the influence radius */
  complete: boolean
}

export interface BurnRecord {
  index: number
  t: number
  x: number
  y: number
  /** heliocentric velocity just before the burn (defines its local frame) */
  vxBefore: number
  vyBefore: number
  dvx: number
  dvy: number
  magnitude: number
  applied: boolean
}

export interface PropagationResult {
  samples: Float64Array
  sampleCount: number
  endReason: EndReason
  endTime: number
  endBodyIndex: number | null
  burns: BurnRecord[]
  flybys: FlybyRecord[]
  /** per body: global closest approach (null for the departure body until the ship has left it) */
  closest: (ApproachPoint | null)[]
  arrival: ApproachPoint | null
  collision: (ApproachPoint & { bodyIndex: number }) | null
  /** rendezvous goals: the slowest moment the ship was inside the zone, still too fast */
  fastPass: ApproachPoint | null
  steps: number
}

const DEFAULT_TOL: Tolerance = { rtol: 1e-10, atol: 1e-12 }

/** Distance at which the departure body is "switched on" for the ship. */
export const departureRadius = (body: { radius: number; influenceRadius: number }): number =>
  Math.max(body.influenceRadius, body.radius * 3)
const STEP_GEOMETRY_FACTOR = 0.2
const SCAN_SUBSTEPS = 16

class SampleBuffer {
  data = new Float64Array(SAMPLE_STRIDE * 2048)
  count = 0

  push(t: number, y: Float64Array): void {
    if ((this.count + 1) * SAMPLE_STRIDE > this.data.length) {
      const next = new Float64Array(this.data.length * 2)
      next.set(this.data)
      this.data = next
    }
    const o = this.count * SAMPLE_STRIDE
    this.data[o] = t
    this.data[o + 1] = y[0]
    this.data[o + 2] = y[1]
    this.data[o + 3] = y[2]
    this.data[o + 4] = y[3]
    this.count++
  }

  toArray(): Float64Array {
    return this.data.slice(0, this.count * SAMPLE_STRIDE)
  }
}

/** Converts a local-frame burn to an inertial Δv for the given velocity. */
export function burnToInertial(vx: number, vy: number, prograde: number, radial: number): { dvx: number; dvy: number } {
  const v = Math.hypot(vx, vy)
  const px = v > 1e-15 ? vx / v : 1
  const py = v > 1e-15 ? vy / v : 0
  // radial-out = velocity direction rotated 90° clockwise
  return { dvx: prograde * px + radial * py, dvy: prograde * py - radial * px }
}

interface StepEnds {
  ta: number
  tb: number
  ya: Float64Array
  yb: Float64Array
}

export function propagate(input: PropagationInput): PropagationResult {
  const { system, target, escapeRadius, departureBodyIndex } = input
  const bodies = system.bodies
  const nb = bodies.length
  const tol = input.tolerance ?? DEFAULT_TOL
  const maxStep = input.maxStep ?? 0.05
  const maxSamples = input.maxSamples ?? 250_000

  const scratch = new Float64Array(nb * 4)
  let ignoredBody = departureBodyIndex ?? -1
  const f = (t: number, y: Float64Array, out: Float64Array) => shipDerivative(system, t, y, scratch, out, ignoredBody)
  const dp = new DormandPrince(4, f, tol)

  const buffer = new SampleBuffer()
  const y = new Float64Array([input.state0.x, input.state0.y, input.state0.vx, input.state0.vy])
  const yNew = new Float64Array(4)
  const k1 = new Float64Array(4)
  const k7 = new Float64Array(4)
  const bodyBuf = new Float64Array(4)
  const ship = newSample()

  const burns = [...input.burns].sort((a, b) => a.t - b.t)
  const burnRecords: BurnRecord[] = burns.map((b, index) => ({
    index, t: b.t, x: NaN, y: NaN, vxBefore: NaN, vyBefore: NaN, dvx: 0, dvy: 0,
    magnitude: Math.hypot(b.prograde, b.radial), applied: false,
  }))

  const closest: (ApproachPoint | null)[] = new Array(nb).fill(null)
  const departed: boolean[] = bodies.map((_, i) => i !== departureBodyIndex)
  const inside: boolean[] = new Array(nb).fill(false)
  const flybyOpen: (FlybyRecord | null)[] = new Array(nb).fill(null)
  const flybys: FlybyRecord[] = []
  let arrival: ApproachPoint | null = null
  let collision: (ApproachPoint & { bodyIndex: number }) | null = null
  let fastPass: ApproachPoint | null = null
  let endReason: EndReason = 'timeout'
  let endBodyIndex: number | null = null

  let t = input.t0
  let burnIdx = 0
  let steps = 0

  const energyOf = (st: Float64Array) => 0.5 * (st[2] * st[2] + st[3] * st[3]) - system.centralMu / Math.hypot(st[0], st[1])

  const bodyAt = (i: number, tt: number): Float64Array => {
    const orbit = bodies[i].orbit
    if (orbit) keplerStateInto(orbit, system.centralMu, tt, bodyBuf, 0)
    else bodyBuf.fill(0)
    return bodyBuf
  }

  const shipAt = (s: StepEnds, tt: number): ShipSample =>
    hermite(s.ta, s.ya[0], s.ya[1], s.ya[2], s.ya[3], s.tb, s.yb[0], s.yb[1], s.yb[2], s.yb[3], tt, ship)

  const relAt = (s: StepEnds, i: number, tt: number) => {
    const sh = shipAt(s, tt)
    const b = bodyAt(i, tt)
    const dx = sh.x - b[0]
    const dy = sh.y - b[1]
    const dvx = sh.vx - b[2]
    const dvy = sh.vy - b[3]
    return { d: Math.hypot(dx, dy), vrel: Math.hypot(dvx, dvy), rr: dx * dvx + dy * dvy, x: sh.x, y: sh.y }
  }

  const bisectCrossing = (s: StepEnds, i: number, lo: number, hi: number, radius: number): number => {
    for (let it = 0; it < 40; it++) {
      const mid = 0.5 * (lo + hi)
      if (relAt(s, i, mid).d <= radius) hi = mid
      else lo = mid
    }
    return hi
  }

  const goldenMin = (s: StepEnds, i: number, lo: number, hi: number): number => {
    const g = 0.6180339887498949
    let a = lo
    let b = hi
    let c = b - g * (b - a)
    let d = a + g * (b - a)
    let fc = relAt(s, i, c).d
    let fd = relAt(s, i, d).d
    for (let it = 0; it < 60 && b - a > 1e-13; it++) {
      if (fc < fd) {
        b = d; d = c; fd = fc; c = b - g * (b - a); fc = relAt(s, i, c).d
      } else {
        a = c; c = d; fc = fd; d = a + g * (b - a); fd = relAt(s, i, d).d
      }
    }
    return 0.5 * (a + b)
  }

  const approachAt = (s: StepEnds, i: number, tt: number): ApproachPoint => {
    const r = relAt(s, i, tt)
    return { t: tt, distance: r.d, relSpeed: r.vrel, x: r.x, y: r.y }
  }

  /** Earliest collision / arrival inside the step, or null. */
  const findTerminalEvent = (s: StepEnds): { kind: 'collision' | 'arrival'; t: number; body: number } | null => {
    let best: { kind: 'collision' | 'arrival'; t: number; body: number } | null = null
    const h = s.tb - s.ta
    for (let i = 0; i < nb; i++) {
      if (i === ignoredBody) continue
      const isTarget = target !== null && target.bodyIndex === i
      const threshold = isTarget ? Math.max(bodies[i].radius, target.zoneRadius) : bodies[i].radius
      const ra = relAt(s, i, s.ta)
      const rb = relAt(s, i, s.tb)
      if (Math.min(ra.d, rb.d) - Math.max(ra.vrel, rb.vrel) * h * 1.5 > threshold) continue

      let prevT = s.ta
      let prevD = ra.d
      for (let k = 1; k <= SCAN_SUBSTEPS; k++) {
        // an earlier event of another body only matters if this substep starts after it
        if (best && prevT >= best.t) break
        const tt = s.ta + (h * k) / SCAN_SUBSTEPS
        const r = relAt(s, i, tt)
        if (isTarget && r.d <= target.zoneRadius) {
          const slowEnough = target.maxRelSpeed === null || r.vrel <= target.maxRelSpeed
          if (slowEnough) {
            const te = prevD > target.zoneRadius ? bisectCrossing(s, i, prevT, tt, target.zoneRadius) : tt
            if (!best || te < best.t) best = { kind: 'arrival', t: te, body: i }
            break
          } else if (!fastPass || r.vrel < fastPass.relSpeed) {
            fastPass = approachAt(s, i, tt)
          }
        }
        if (r.d <= bodies[i].radius) {
          const te = bisectCrossing(s, i, prevT, tt, bodies[i].radius)
          if (!best || te < best.t) best = { kind: 'collision', t: te, body: i }
          break
        }
        prevT = tt
        prevD = r.d
      }
    }
    return best
  }

  let releasedThisStep = false

  /** Closest-approach and flyby bookkeeping over [ta, tb]. */
  const track = (s: StepEnds, speedA: number, speedB: number): void => {
    for (let i = 0; i < nb; i++) {
      const ra = relAt(s, i, s.ta)
      const rb = relAt(s, i, s.tb)
      const infR = bodies[i].influenceRadius
      if (!departed[i]) {
        if (rb.d > departureRadius(bodies[i])) {
          departed[i] = true
          ignoredBody = -1
          releasedThisStep = true
        }
        continue
      }
      let minT = ra.d <= rb.d ? s.ta : s.tb
      if (ra.rr < 0 && rb.rr >= 0) minT = goldenMin(s, i, s.ta, s.tb)
      const ap = approachAt(s, i, minT)
      const c = closest[i]
      if (!c || ap.distance < c.distance) closest[i] = ap

      if (infR <= 0) continue
      const nowInside = rb.d < infR
      if (!inside[i] && nowInside) {
        flybyOpen[i] = {
          ...ap, bodyIndex: i, tIn: s.tb, tOut: NaN, speedIn: speedA, speedOut: NaN,
          energyIn: energyOf(s.ya), energyOut: NaN, deltaV: 0, vxIn: s.ya[2], vyIn: s.ya[3],
          burnEnergy: 0, burnDvx: 0, burnDvy: 0, complete: false,
        }
      }
      const open = flybyOpen[i]
      if (open && ap.distance < open.distance) Object.assign(open, ap)
      if (inside[i] && !nowInside && open) {
        open.tOut = s.tb
        open.speedOut = speedB
        open.energyOut = energyOf(s.yb)
        open.deltaV = Math.hypot(s.yb[2] - open.vxIn - open.burnDvx, s.yb[3] - open.vyIn - open.burnDvy)
        open.complete = true
        flybys.push(open)
        flybyOpen[i] = null
      }
      inside[i] = nowInside
    }
  }

  const applyBurn = (index: number): void => {
    const b = burns[index]
    const rec = burnRecords[index]
    const { dvx, dvy } = burnToInertial(y[2], y[3], b.prograde, b.radial)
    rec.vxBefore = y[2]
    rec.vyBefore = y[3]
    const energyBefore = energyOf(y)
    y[2] += dvx
    y[3] += dvy
    for (const open of flybyOpen) {
      if (!open) continue
      open.burnEnergy += energyOf(y) - energyBefore
      open.burnDvx += dvx
      open.burnDvy += dvy
    }
    rec.x = y[0]
    rec.y = y[1]
    rec.dvx = dvx
    rec.dvy = dvy
    rec.applied = true
    buffer.push(t, y)
  }

  buffer.push(t, y)
  while (burnIdx < burns.length && burns[burnIdx].t <= t) applyBurn(burnIdx++)
  f(t, y, k1)
  let h = Math.min(maxStep, 1e-3)

  const ends: StepEnds = { ta: 0, tb: 0, ya: new Float64Array(4), yb: new Float64Array(4) }

  for (;;) {
    if (buffer.count >= maxSamples) {
      endReason = 'step-limit'
      break
    }
    const boundary = burnIdx < burns.length ? Math.min(burns[burnIdx].t, input.tEnd) : input.tEnd

    // geometric step limit: never move more than a fraction of the distance to any body per step
    let hGeo = maxStep
    for (let i = 0; i < nb; i++) {
      const b = bodyAt(i, t)
      const raw = Math.hypot(y[0] - b[0], y[1] - b[1])
      // the not-yet-released departure body exerts no force; only keep steps short enough to see the release
      const d = i === ignoredBody ? Math.max(raw, departureRadius(bodies[i]) * 0.25) : raw
      const vrel = Math.hypot(y[2] - b[2], y[3] - b[3])
      if (vrel > 1e-12) hGeo = Math.min(hGeo, (STEP_GEOMETRY_FACTOR * d) / vrel)
    }
    let hTry = Math.min(h, hGeo, boundary - t)
    const clipped = hTry === boundary - t
    if (hTry < 1e-13) {
      if (boundary - t < 1e-13) {
        t = boundary
      } else {
        endReason = 'step-limit'
        break
      }
    } else {
      const err = dp.attempt(t, y, hTry, k1, yNew, k7)
      steps++
      if (err > 1) {
        h = hTry * nextStepFactor(err)
        continue
      }
      ends.ta = t
      ends.tb = t + hTry
      ends.ya.set(y)
      ends.yb.set(yNew)

      const terminal = findTerminalEvent(ends)
      if (terminal) {
        ends.tb = terminal.t
        const end = shipAt({ ...ends, tb: t + hTry }, terminal.t)
        ends.yb[0] = end.x; ends.yb[1] = end.y; ends.yb[2] = end.vx; ends.yb[3] = end.vy
        track(ends, Math.hypot(y[2], y[3]), Math.hypot(end.vx, end.vy))
        const ap = approachAt(ends, terminal.body, terminal.t)
        t = terminal.t
        y.set(ends.yb)
        buffer.push(t, y)
        endBodyIndex = terminal.body
        if (terminal.kind === 'arrival') {
          endReason = 'arrived'
          arrival = ap
        } else {
          endReason = 'collision'
          collision = { ...ap, bodyIndex: terminal.body }
        }
        break
      }

      track(ends, Math.hypot(y[2], y[3]), Math.hypot(yNew[2], yNew[3]))
      t = clipped ? boundary : t + hTry
      y.set(yNew)
      k1.set(k7)
      if (releasedThisStep) {
        // the departure body now attracts the ship: FSAL derivative must include it
        releasedThisStep = false
        f(t, y, k1)
      }
      buffer.push(t, y)
      h = hTry * nextStepFactor(err)
      if (clipped) h = Math.max(h, maxStep * 0.1)

      if (Math.hypot(y[0], y[1]) > escapeRadius) {
        endReason = 'escaped'
        break
      }
    }

    if (t >= boundary) {
      if (burnIdx < burns.length && burns[burnIdx].t <= t) {
        while (burnIdx < burns.length && burns[burnIdx].t <= t) applyBurn(burnIdx++)
        f(t, y, k1)
        continue
      }
      if (t >= input.tEnd) {
        endReason = 'timeout'
        break
      }
    }
  }

  for (let i = 0; i < nb; i++) {
    const open = flybyOpen[i]
    if (open) {
      open.tOut = t
      open.speedOut = Math.hypot(y[2], y[3])
      open.energyOut = energyOf(y)
      open.deltaV = Math.hypot(y[2] - open.vxIn - open.burnDvx, y[3] - open.vyIn - open.burnDvy)
      flybys.push(open)
    }
  }
  flybys.sort((a, b) => a.t - b.t)

  return {
    samples: buffer.toArray(),
    sampleCount: buffer.count,
    endReason,
    endTime: t,
    endBodyIndex,
    burns: burnRecords,
    flybys,
    closest,
    arrival,
    collision,
    fastPass,
    steps,
  }
}
