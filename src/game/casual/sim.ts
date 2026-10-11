import type { StateVector } from '../physics/ephemeris'
import { findSampleIndex, newSample, sampleTrajectory, SAMPLE_STRIDE, type ShipSample } from '../physics/interpolate'
import { departureRadius, propagate, type FlybyRecord, type PropagationResult } from '../physics/propagate'
import { bodyState } from '../physics/system'
import type { CasualLevel } from './types'
import { buildWorld, launchFrom, type CasualWorld } from './world'

export const ESCAPE_RADIUS = 9.5
/** stardust is picked up within this distance (model units) */
export const STARDUST_RADIUS = 0.13
/** a boost is never weaker than this share of a full charge (a quick tap) */
export const MIN_CHARGE = 0.15

/** One ballistic stretch of the flight: from launch or from a boost until the next boost or the end. */
export interface Segment {
  t0: number
  result: PropagationResult
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

/**
 * A live flight: the same honest propagator, re-run from the current state every time the player boosts.
 * Everything is deterministic: the same launch and the same boosts at the same times give the same flight.
 */
export class Flight {
  readonly world: CasualWorld
  readonly segments: Segment[] = []
  readonly collected: boolean[]
  readonly boostsUsed: { t: number; dvx: number; dvy: number }[] = []
  private fuelUsed = 0
  private readonly tmp = newSample()

  constructor(
    readonly level: CasualLevel,
    readonly launch: { dvx: number; dvy: number },
    world?: CasualWorld,
  ) {
    this.world = world ?? buildWorld(level)
    this.collected = level.stardust.map(() => false)
    this.segments.push({ t0: 0, result: this.fly(0, launchFrom(this.world, launch.dvx, launch.dvy)) })
  }

  /** Δv still in the tank, model units */
  get fuelLeft(): number {
    return Math.max(0, this.level.fuel - this.fuelUsed)
  }

  /** Δv a boost charged to `charge` (0…1) gives right now: a quick tap is weak, the tank may run dry. */
  boostSize(charge: number): number {
    const want = this.level.boostMax * Math.min(1, Math.max(MIN_CHARGE, charge))
    return Math.min(want, this.fuelLeft)
  }

  /** The state just after a boost of `charge` at time t towards (dirX, dirY), or null when not possible. */
  boostState(t: number, dirX: number, dirY: number, charge: number): StateVector | null {
    const len = Math.hypot(dirX, dirY)
    const dv = this.boostSize(charge)
    if (dv < 1e-9 || len < 1e-9 || t >= this.end.t) return null
    const s = this.stateAt(t, newSample())
    return { x: s.x, y: s.y, vx: s.vx + (dirX / len) * dv, vy: s.vy + (dirY / len) * dv }
  }

  get current(): Segment {
    return this.segments[this.segments.length - 1]
  }

  get end(): FlightEnd {
    return segmentEnd(this.current)
  }

  private segmentAt(t: number): Segment {
    for (let i = this.segments.length - 1; i > 0; i--) if (t >= this.segments[i].t0) return this.segments[i]
    return this.segments[0]
  }

  stateAt(t: number, out: ShipSample = this.tmp): ShipSample {
    const seg = this.segmentAt(t)
    return sampleTrajectory(seg.result.samples, seg.result.sampleCount, Math.min(t, seg.result.endTime), out)
  }

  private fly(t0: number, state0: StateVector, tEnd = this.level.horizon): PropagationResult {
    const { system, homeIndex, targetIndex } = this.world
    const home = bodyState(system, homeIndex, t0)
    // still inside the launch planet's well (boost right after launch): keep the departure rules
    const nearHome = Math.hypot(state0.x - home.x, state0.y - home.y) < departureRadius(system.bodies[homeIndex])
    return propagate({
      system,
      t0,
      state0,
      burns: [],
      tEnd,
      target: { bodyIndex: targetIndex, zoneRadius: this.level.target.zoneRadius, maxRelSpeed: null },
      escapeRadius: ESCAPE_RADIUS,
      departureBodyIndex: nearHome ? homeIndex : null,
      maxStep: 0.03,
    })
  }

  /** Fires a boost of `charge` (0…1) at time t towards (dirX, dirY) (any length). Returns false when not possible. */
  boost(t: number, dirX: number, dirY: number, charge: number): boolean {
    const st = this.boostState(t, dirX, dirY, charge)
    if (!st) return false
    const before = this.stateAt(t, newSample())
    const dvx = st.vx - before.vx
    const dvy = st.vy - before.vy
    this.fuelUsed += Math.hypot(dvx, dvy)
    this.boostsUsed.push({ t, dvx, dvy })
    this.segments.push({ t0: t, result: this.fly(t, st) })
    return true
  }

  /** Where the flight would go after such a boost, for the charging preview (up to `until`). */
  previewBoost(t: number, dirX: number, dirY: number, charge: number, until: number): PropagationResult | null {
    const st = this.boostState(t, dirX, dirY, charge)
    return st ? this.fly(t, st, Math.min(this.level.horizon, t + until)) : null
  }

  /**
   * Flybys of the flight as actually flown. A boost cuts off what the earlier segment predicted after it; a flyby the
   * boost interrupted continues in the next segment and is merged back into one record, with the boost counted as
   * engine energy (so it never shows up as gravity gain).
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
        let rec: FlybyRecord = { ...f }
        const k = incoming.findIndex((p) => p.bodyIndex === f.bodyIndex)
        if (k >= 0 && f.tIn <= seg.t0 + 0.05) {
          const p = incoming.splice(k, 1)[0]
          const closer = p.distance < f.distance ? p : f
          rec = {
            ...f,
            t: closer.t, distance: closer.distance, relSpeed: closer.relSpeed, x: closer.x, y: closer.y,
            tIn: p.tIn, speedIn: p.speedIn, energyIn: p.energyIn, vxIn: p.vxIn, vyIn: p.vyIn,
            burnEnergy: p.burnEnergy + f.burnEnergy, burnDvx: p.burnDvx + f.burnDvx, burnDvy: p.burnDvy + f.burnDvy,
          }
        }
        if (next && rec.tOut > until) {
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

  /** Picks up stardust touched between t0 and t1; returns the indices collected now. */
  collect(t0: number, t1: number): number[] {
    const got: number[] = []
    const end = Math.min(t1, this.end.t)
    if (end <= t0) return got
    const steps = Math.max(1, Math.ceil((end - t0) / 0.004))
    const s = this.tmp
    for (let k = 0; k <= steps; k++) {
      this.stateAt(t0 + ((end - t0) * k) / steps, s)
      this.level.stardust.forEach(([x, y], i) => {
        if (!this.collected[i] && Math.hypot(s.x - x, s.y - y) <= STARDUST_RADIUS) {
          this.collected[i] = true
          got.push(i)
        }
      })
    }
    return got
  }

  /** Plays the whole flight at once (tests, tools, the level constructor). */
  runToEnd(): this {
    this.collect(0, this.end.t)
    return this
  }
}

/** Positions along the first segment, for the aiming preview (up to `until`). */
export function previewPath(level: CasualLevel, world: CasualWorld, dvx: number, dvy: number, until: number): PropagationResult {
  return propagate({
    system: world.system,
    t0: 0,
    state0: launchFrom(world, dvx, dvy),
    burns: [],
    tEnd: Math.min(until, level.horizon),
    target: { bodyIndex: world.targetIndex, zoneRadius: level.target.zoneRadius, maxRelSpeed: null },
    escapeRadius: ESCAPE_RADIUS,
    departureBodyIndex: world.homeIndex,
    maxStep: 0.03,
  })
}

/** Index helper re-exported for renderers walking a segment. */
export { findSampleIndex, SAMPLE_STRIDE }
