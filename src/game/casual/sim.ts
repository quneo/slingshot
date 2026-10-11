import type { StateVector } from '../physics/ephemeris'
import { newSample, sampleTrajectory, SAMPLE_STRIDE, type ShipSample } from '../physics/interpolate'
import { departureRadius, propagate, type ApproachPoint, type FlybyRecord, type PropagationResult } from '../physics/propagate'
import { bodyState } from '../physics/system'
import type { Hop, Mission } from './types'
import { freeCaptureSpeed, launchState, type CasualWorld } from './world'

export const ESCAPE_RADIUS = 9.5
/** a boost is never weaker than this share of a full charge (a quick tap) */
export const MIN_CHARGE = 0.15
/**
 * Longest integrator step, model time. Close passes are still resolved finely (the step is also limited by the
 * distance to every body); this only sets how coarse the cruise is, i.e. the cost of a forecast on a phone.
 */
export const MAX_STEP = 0.08

/** One ballistic stretch of the flight: from launch or from a boost until the next boost or the end. */
export interface Segment {
  t0: number
  result: PropagationResult
  /** still leaving the origin planet: it does not stop the ship until the ship is clear of it */
  departing: boolean
}

export type EndReason = 'arrived' | 'crashed' | 'lost' | 'timeout'

export interface FlightEnd {
  reason: EndReason
  t: number
  /** the body the ship hit (crash) or reached (arrival) */
  bodyIndex: number | null
}

function segmentEnd(seg: Segment): FlightEnd {
  const r = seg.result
  const reason: EndReason =
    r.endReason === 'arrived' ? 'arrived' : r.endReason === 'collision' ? 'crashed' : r.endReason === 'escaped' ? 'lost' : 'timeout'
  return { reason, t: r.endTime, bodyIndex: r.endBodyIndex }
}

const approachOf = (a: ApproachPoint): ApproachPoint => ({ t: a.t, distance: a.distance, relSpeed: a.relSpeed, x: a.x, y: a.y })

/** Where a hop goes and from where; shared by the live flight and the aiming forecast. */
export interface HopContext {
  mission: Mission
  world: CasualWorld
  hop: Hop
  origin: number
  target: number
}

export function hopContext(mission: Mission, world: CasualWorld, hopIndex: number): HopContext {
  const hop = mission.hops[hopIndex]
  const origin = world.indexOf(hopIndex === 0 ? mission.start : mission.hops[hopIndex - 1].to)
  return { mission, world, hop, origin, target: world.indexOf(hop.to) }
}

/** Propagates one ballistic stretch of a hop. */
export function flyHop(ctx: HopContext, t0: number, state0: StateVector, departing: boolean, tEnd: number): PropagationResult {
  return propagate({
    system: ctx.world.systemFrom(ctx.origin),
    t0,
    state0,
    burns: [],
    tEnd,
    target: { bodyIndex: ctx.target, zoneRadius: ctx.hop.zoneRadius, maxRelSpeed: null },
    escapeRadius: ESCAPE_RADIUS,
    departureBodyIndex: departing ? ctx.origin : null,
    maxStep: MAX_STEP,
  })
}

/** Δv the capture at the end of a hop takes: whatever the arrival exceeds the planet's escape speed by. */
export function captureCost(ctx: HopContext, relSpeed: number): number {
  return Math.max(0, relSpeed - freeCaptureSpeed(ctx.world, ctx.target, ctx.hop.zoneRadius))
}

/** The aiming forecast: a throw at time t from the origin, up to the hop's preview length. */
export function forecastHop(ctx: HopContext, t: number, dvx: number, dvy: number): PropagationResult {
  const until = t + Math.min(ctx.hop.previewTime, ctx.hop.maxFlight)
  return flyHop(ctx, t, launchState(ctx.world, ctx.origin, t, dvx, dvy), true, until)
}

/**
 * One hop in flight: the same honest propagator, re-run from the current state every time the player boosts.
 * Deterministic: the same launch and the same boosts at the same times give the same flight.
 */
export class Flight {
  readonly segments: Segment[] = []
  readonly boostsUsed: { t: number; dvx: number; dvy: number }[] = []
  readonly tEnd: number
  private boostDv = 0
  private readonly tmp = newSample()

  constructor(
    readonly ctx: HopContext,
    readonly launchTime: number,
    readonly launch: { dvx: number; dvy: number },
    /** fuel in the tank after paying for the launch */
    readonly fuelAtLaunch: number,
  ) {
    this.tEnd = launchTime + ctx.hop.maxFlight
    const st = launchState(ctx.world, ctx.origin, launchTime, launch.dvx, launch.dvy)
    this.segments.push({ t0: launchTime, result: flyHop(ctx, launchTime, st, true, this.tEnd), departing: true })
  }

  get world(): CasualWorld {
    return this.ctx.world
  }

  /** Δv spent on boosts in this hop */
  get boostSpent(): number {
    return this.boostDv
  }

  get fuelLeft(): number {
    return Math.max(0, this.fuelAtLaunch - this.boostDv)
  }

  get current(): Segment {
    return this.segments[this.segments.length - 1]
  }

  get end(): FlightEnd {
    return segmentEnd(this.current)
  }

  /** speed relative to the target on arrival (null unless arrived) */
  get arrivalSpeed(): number | null {
    const a = this.current.result.arrival
    return this.end.reason === 'arrived' && a ? a.relSpeed : null
  }

  /** Δv the capture will take on arrival (null unless arrived) */
  get captureCost(): number | null {
    const v = this.arrivalSpeed
    return v === null ? null : captureCost(this.ctx, v)
  }

  private segmentAt(t: number): Segment {
    for (let i = this.segments.length - 1; i > 0; i--) if (t >= this.segments[i].t0) return this.segments[i]
    return this.segments[0]
  }

  stateAt(t: number, out: ShipSample = this.tmp): ShipSample {
    const seg = this.segmentAt(t)
    return sampleTrajectory(seg.result.samples, seg.result.sampleCount, Math.min(t, seg.result.endTime), out)
  }

  /** Δv a boost charged to `charge` (0…1) gives right now: a quick tap is weak, the tank may run dry. */
  boostSize(charge: number): number {
    const want = this.ctx.mission.boostMax * Math.min(1, Math.max(MIN_CHARGE, charge))
    return Math.min(want, this.fuelLeft)
  }

  /** The state just after a boost of `charge` at time t towards (dirX, dirY), or null when not possible. */
  boostState(t: number, dirX: number, dirY: number, charge: number): StateVector | null {
    const len = Math.hypot(dirX, dirY)
    const dv = this.boostSize(charge)
    if (dv < 1e-9 || len < 1e-9 || t >= this.end.t || t < this.launchTime) return null
    const s = this.stateAt(t, newSample())
    return { x: s.x, y: s.y, vx: s.vx + (dirX / len) * dv, vy: s.vy + (dirY / len) * dv }
  }

  /**
   * A boost right after the launch, while the ship is still inside the origin's departure radius, keeps the
   * departure rules. Once the ship has been clear of the planet, it is an ordinary solid body again.
   */
  private stillDeparting(t: number): boolean {
    const seg = this.segmentAt(t)
    if (!seg.departing) return false
    const { system } = this.world
    const origin = this.ctx.origin
    const limit = departureRadius(system.bodies[origin])
    const r = seg.result
    const clear = (x: number, y: number, tk: number) => {
      const p = bodyState(system, origin, tk)
      return Math.hypot(x - p.x, y - p.y) >= limit
    }
    for (let k = 0; k < r.sampleCount; k++) {
      const tk = r.samples[k * SAMPLE_STRIDE]
      if (tk > t) break
      if (clear(r.samples[k * SAMPLE_STRIDE + 1], r.samples[k * SAMPLE_STRIDE + 2], tk)) return false
    }
    const s = this.stateAt(t, newSample())
    return !clear(s.x, s.y, t)
  }

  /** Fires a boost of `charge` (0…1) at time t towards (dirX, dirY). Returns false when not possible. */
  boost(t: number, dirX: number, dirY: number, charge: number): boolean {
    const st = this.boostState(t, dirX, dirY, charge)
    if (!st) return false
    const before = this.stateAt(t, newSample())
    const dvx = st.vx - before.vx
    const dvy = st.vy - before.vy
    this.boostDv += Math.hypot(dvx, dvy)
    this.boostsUsed.push({ t, dvx, dvy })
    const departing = this.stillDeparting(t)
    this.segments.push({ t0: t, result: flyHop(this.ctx, t, st, departing, this.tEnd), departing })
    return true
  }

  /** Where the flight would go after such a boost, for the charging forecast (up to `ahead` model time). */
  previewBoost(t: number, dirX: number, dirY: number, charge: number, ahead: number): PropagationResult | null {
    const st = this.boostState(t, dirX, dirY, charge)
    return st ? flyHop(this.ctx, t, st, this.stillDeparting(t), Math.min(this.tEnd, t + ahead)) : null
  }

  /**
   * Flybys as actually flown. A boost cuts off what the earlier segment predicted after it; a flyby the boost
   * interrupted continues in the next segment and is merged back into one record, with the boost counted as engine
   * energy (never as gravity gain) and the closest approach taken only along the part actually flown.
   */
  flybys(): FlybyRecord[] {
    const mu = this.world.system.centralMu
    const energy = (x: number, y: number, vx: number, vy: number) => 0.5 * (vx * vx + vy * vy) - mu / Math.hypot(x, y)
    const out: FlybyRecord[] = []
    let carry: FlybyRecord[] = []
    this.segments.forEach((seg, i) => {
      const next = this.segments[i + 1]
      const until = next ? next.t0 : Infinity
      const incoming = carry
      carry = []
      for (const f of seg.result.flybys) {
        if (f.tIn > until) continue
        const cut = !!next && f.tOut > until
        const near: ApproachPoint = cut ? this.closestBetween(seg, f.bodyIndex, Math.max(seg.t0, f.tIn), until) : f
        let rec: FlybyRecord = { ...f, ...approachOf(near) }
        const k = incoming.findIndex((p) => p.bodyIndex === f.bodyIndex)
        if (k >= 0 && f.tIn <= seg.t0 + 0.05) {
          const p = incoming.splice(k, 1)[0]
          rec = {
            ...rec,
            ...approachOf(p.distance < near.distance ? p : near),
            tIn: p.tIn, speedIn: p.speedIn, energyIn: p.energyIn, vxIn: p.vxIn, vyIn: p.vyIn,
            burnEnergy: p.burnEnergy + f.burnEnergy, burnDvx: p.burnDvx + f.burnDvx, burnDvy: p.burnDvy + f.burnDvy,
          }
        }
        if (cut) {
          const b = this.boostsUsed[i]
          const s = sampleTrajectory(seg.result.samples, seg.result.sampleCount, until, newSample())
          const before = energy(s.x, s.y, s.vx, s.vy)
          const after = energy(s.x, s.y, s.vx + b.dvx, s.vy + b.dvy)
          // ends here unless the next segment carries on inside the same sphere
          carry.push({
            ...rec, tOut: until, speedOut: Math.hypot(s.vx + b.dvx, s.vy + b.dvy), energyOut: after, complete: true,
            burnEnergy: rec.burnEnergy + after - before, burnDvx: rec.burnDvx + b.dvx, burnDvy: rec.burnDvy + b.dvy,
          })
          continue
        }
        out.push(rec)
      }
      out.push(...incoming)
    })
    out.push(...carry)
    return out.sort((a, b) => a.tIn - b.tIn)
  }

  /** Closest approach of a segment's path to a body between t0 and t1 (samples plus both ends). */
  private closestBetween(seg: Segment, bodyIndex: number, t0: number, t1: number): ApproachPoint {
    const sys = this.world.system
    const r = seg.result
    const st = newSample()
    let best: ApproachPoint = { t: t0, distance: Infinity, relSpeed: 0, x: 0, y: 0 }
    const consider = (t: number) => {
      sampleTrajectory(r.samples, r.sampleCount, t, st)
      const p = bodyState(sys, bodyIndex, t)
      const d = Math.hypot(st.x - p.x, st.y - p.y)
      if (d < best.distance) best = { t, distance: d, relSpeed: Math.hypot(st.vx - p.vx, st.vy - p.vy), x: st.x, y: st.y }
    }
    consider(t0)
    for (let k = 0; k < r.sampleCount; k++) {
      const tk = r.samples[k * SAMPLE_STRIDE]
      if (tk > t0 && tk < t1) consider(tk)
    }
    consider(t1)
    return best
  }
}
