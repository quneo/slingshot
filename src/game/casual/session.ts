import { newSample, SAMPLE_STRIDE, sampleTrajectory, type ShipSample } from '../physics/interpolate'
import type { ApproachPoint, FlybyRecord, PropagationResult } from '../physics/propagate'
import { bodyState } from '../physics/system'
import { toKms } from '../physics/units'
import { CLOSE_PASS_RADII, slingshotGain, SLINGSHOT_MIN_KMS, starsFor, totalSpent, type Spending } from './scoring'
import { captureCost, Flight, forecastHop, hopContext, type EndReason, type HopContext } from './sim'
import type { Mission } from './types'
import { lambert } from '../physics/lambert'
import { buildWorld, freeCaptureSpeed, type CasualWorld } from './world'

export type Phase = 'parked' | 'flight' | 'capture' | 'complete' | 'failed'

export type FailReason = Exclude<EndReason, 'arrived'> | 'fuel' | 'deadline'

/** Things that happened this frame: the renderer turns them into particles and captions, the audio into sounds. */
export type GameEvent =
  | { kind: 'launch'; power: number; cost: number }
  | { kind: 'boost'; x: number; y: number; dirX: number; dirY: number; size: number }
  | { kind: 'flybyIn'; bodyIndex: number }
  | { kind: 'slingshot'; bodyIndex: number; gainKms: number; combo: number; close: boolean; x: number; y: number }
  | { kind: 'captured'; bodyIndex: number; cost: number; x: number; y: number; last: boolean }
  | { kind: 'complete'; stars: number; spent: number }
  | { kind: 'failed'; reason: FailReason; bodyIndex: number | null; x: number; y: number; need: number }

/** The aiming forecast, with what the hop would cost if flown like this. */
export interface Forecast {
  result: PropagationResult
  /** Δv of the throw itself */
  launchCost: number
  /** null when the forecast does not reach the target */
  captureCost: number | null
  /** closest approach to the target along the forecast */
  closest: ApproachPoint | null
}

/**
 * Launch windows ahead of a parked ship: the cheapest hop (launch + capture) for a launch at each moment, from
 * Lambert's problem around the star. An estimate — the real flight also feels the planets — but it shows where the
 * dips are, so the player knows how long to wait.
 */
export interface WindowChart {
  hopIndex: number
  /** model time of the first sample and the span covered */
  t0: number
  span: number
  /** cheapest Δv for a launch at t0 + span·i/(n−1) */
  costs: Float64Array
}

/** Real seconds a boost takes to charge fully. */
export const CHARGE_TIME = 0.75
/** After a failed attempt the hop restarts by itself after this many real seconds. */
export const FAIL_PAUSE = 1.6
/** Real seconds of the capture moment before the ship parks and the next window clock starts. */
export const CAPTURE_TIME = 1.5
/** During the capture moment the clock runs at this share of the hop's cruise speed. */
const CAPTURE_PACE = 0.25
/** Model time that passes during the capture moment of a hop flown at `flightPace` (exact, not frame-dependent). */
export const captureDrift = (flightPace: number): number => CAPTURE_TIME * flightPace * CAPTURE_PACE
/** The clock while parked: fast forward and the slow-down while the slingshot is held. */
export const FAST_FORWARD = 6
export const AIM_SLOWDOWN = 0.3
/** Planets heavier than this bend the path visibly: slow motion and a "flyby" moment near them. */
const GIANT_MU = 1e-3

const smooth = (a: number, b: number, x: number) => {
  const k = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return k * k * (3 - 2 * k)
}

/**
 * One mission being played: parked at a planet waiting for a window, the live hop, boosts, captures, the tank, the
 * mission clock. Pure game logic (no canvas, no DOM): the controller feeds it real time and input, the renderer and
 * audio read its state and events.
 */
export class Session {
  readonly world: CasualWorld
  phase: Phase = 'parked'
  hopIndex = 0
  /** mission time, model units */
  t = 0
  fuel: number
  spent: Spending = { launch: 0, capture: 0, boost: 0 }
  /** the start of the current hop (when the ship parked there): a failed hop goes back here */
  checkpoint: { t: number; fuel: number; spent: Spending }
  /** real seconds since the phase began */
  phaseClock = 0
  /** model time per real second right now (smoothed) */
  timeScale = 0
  /** pull of the slingshot as a launch Δv, null when not aiming */
  aim: { dvx: number; dvy: number } | null = null
  /** the slingshot is being held: the clock slows down */
  aiming = false
  fastForward = false
  flight: Flight | null = null
  /** previous attempt at this hop: launch and path, for the ghost */
  ghost: { launch: { dvx: number; dvy: number }; path: Float32Array } | null = null
  charge: { dirX: number; dirY: number; held: number } | null = null
  failure: Extract<GameEvent, { kind: 'failed' }> | null = null
  /** attempts and failures at the current hop */
  attempts = 0
  failures = 0
  result: { stars: number; spent: number } | null = null
  /** Δv each finished hop took */
  hopCosts: number[] = []
  events: GameEvent[] = []

  private ctxCache: HopContext | null = null
  private flybyCache: FlybyRecord[] | null = null
  private entered = new Set<string>()
  private announced = new Set<string>()
  private combo = 0
  private captureStart = 0
  private forecastCache: { key: string; value: Forecast } | null = null
  private chargeCache: { key: string; result: PropagationResult | null } | null = null
  private chartCache: WindowChart | null = null
  private readonly tmp = newSample()

  constructor(readonly mission: Mission) {
    this.world = buildWorld(mission)
    this.fuel = mission.fuel
    this.checkpoint = { t: 0, fuel: this.fuel, spent: { ...this.spent } }
  }

  get ctx(): HopContext {
    if (!this.ctxCache || this.ctxCache.hop !== this.mission.hops[Math.min(this.hopIndex, this.mission.hops.length - 1)]) {
      this.ctxCache = hopContext(this.mission, this.world, Math.min(this.hopIndex, this.mission.hops.length - 1))
    }
    return this.ctxCache
  }

  /** the planet the ship is parked at (or left from) */
  get origin(): number {
    return this.ctx.origin
  }

  get target(): number {
    return this.ctx.target
  }

  get totalSpent(): number {
    return totalSpent(this.spent)
  }

  /** the longest throw possible now: the slingshot's power, or what is left in the tank */
  get maxThrow(): number {
    return Math.min(this.mission.power, this.fuel)
  }

  // ───────────────────────────── aiming

  setAim(dvx: number, dvy: number): void {
    if (this.phase !== 'parked') return
    const m = Math.hypot(dvx, dvy)
    const cap = this.maxThrow
    const k = m > cap ? cap / Math.max(m, 1e-12) : 1
    this.aim = { dvx: dvx * k, dvy: dvy * k }
  }

  clearAim(): void {
    this.aim = null
  }

  /** The forecast for the current pull at the current moment (recomputed a few dozen times a second at most). */
  forecast(): Forecast | null {
    if (!this.aim || this.phase !== 'parked') return null
    const ctx = this.ctx
    const q = this.mission.power / 1500
    const key = `${this.hopIndex},${Math.round(this.aim.dvx / q)},${Math.round(this.aim.dvy / q)},${Math.floor(this.t / (ctx.hop.parkPace * 0.015))}`
    if (this.forecastCache?.key !== key) {
      const result = forecastHop(ctx, this.t, this.aim.dvx, this.aim.dvy)
      const arrived = result.endReason === 'arrived' && result.arrival
      this.forecastCache = {
        key,
        value: {
          result,
          launchCost: Math.hypot(this.aim.dvx, this.aim.dvy),
          captureCost: arrived ? captureCost(ctx, result.arrival!.relSpeed) : null,
          closest: result.closest[ctx.target],
        },
      }
    }
    return this.forecastCache.value
  }

  launch(): boolean {
    if (this.phase !== 'parked' || !this.aim) return false
    const { dvx, dvy } = this.aim
    const cost = Math.hypot(dvx, dvy)
    if (cost < this.mission.power * 0.05 || cost > this.fuel + 1e-12) return false
    this.fuel -= cost
    this.spent.launch += cost
    this.flight = new Flight(this.ctx, this.t, { dvx, dvy }, this.fuel)
    this.phase = 'flight'
    this.phaseClock = 0
    this.timeScale = this.ctx.hop.flightPace * 0.3
    this.attempts++
    this.flybyCache = null
    this.entered.clear()
    this.announced.clear()
    this.combo = 0
    this.failure = null
    this.aim = null
    this.aiming = false
    this.events.push({ kind: 'launch', power: cost / this.mission.power, cost })
    return true
  }

  /** Back to the start of the current hop; the attempt in progress (if any) becomes the ghost. */
  retryHop(): void {
    if (this.flight) this.ghost = { launch: this.flight.launch, path: this.flownPath() }
    this.flight = null
    this.phase = 'parked'
    this.phaseClock = 0
    this.t = this.checkpoint.t
    this.fuel = this.checkpoint.fuel
    this.spent = { ...this.checkpoint.spent }
    this.charge = null
    this.chargeCache = null
    this.aim = null
    this.aiming = false
    this.failure = null
    this.forecastCache = null
    this.hopCosts.length = this.hopIndex
  }

  /** From the very beginning: first planet, full tank, day zero. */
  restartMission(): void {
    this.flight = null
    this.hopIndex = 0
    this.ctxCache = null
    this.checkpoint = { t: 0, fuel: this.mission.fuel, spent: { launch: 0, capture: 0, boost: 0 } }
    this.ghost = null
    this.attempts = 0
    this.failures = 0
    this.result = null
    this.retryHop()
  }

  /** The windows chart for the hop the ship is parked for (computed once per parking). */
  windowChart(): WindowChart {
    const t0 = this.checkpoint.t
    const c = this.chartCache
    if (c && c.hopIndex === this.hopIndex && c.t0 === t0) return c
    const ctx = this.ctx
    const sys = this.world.system
    const rA = sys.bodies[ctx.origin].orbit!.a
    const rB = sys.bodies[ctx.target].orbit!.a
    const synodic = (2 * Math.PI) / Math.abs(Math.pow(rA, -1.5) - Math.pow(rB, -1.5))
    const hohmann = Math.PI * Math.pow((rA + rB) / 2, 1.5)
    const span = Math.min(synodic * 1.15, Math.max(10, ctx.hop.reference.wait * 3 + 8))
    const vfree = freeCaptureSpeed(this.world, ctx.target, ctx.hop.zoneRadius)
    const n = 64
    const costs = new Float64Array(n)
    for (let i = 0; i < n; i++) {
      const t = t0 + (span * i) / (n - 1)
      const a = bodyState(sys, ctx.origin, t)
      let best = Infinity
      for (let tof = hohmann * 0.3; tof <= hohmann * 1.6; tof *= 1.04) {
        const b = bodyState(sys, ctx.target, t + tof)
        const L = lambert(a.x, a.y, b.x, b.y, tof)
        if (!L) continue
        const cost = Math.hypot(L.v1x - a.vx, L.v1y - a.vy) + Math.max(0, Math.hypot(L.v2x - b.vx, L.v2y - b.vy) - vfree)
        if (cost < best) best = cost
      }
      costs[i] = best
    }
    this.chartCache = { hopIndex: this.hopIndex, t0, span, costs }
    return this.chartCache
  }

  // ───────────────────────────── boosts

  get canBoost(): boolean {
    return this.phase === 'flight' && !!this.flight && this.flight.fuelLeft > 1e-9
  }

  startCharge(dirX: number, dirY: number): boolean {
    if (!this.canBoost) return false
    this.charge = { dirX, dirY, held: 0 }
    return true
  }

  aimCharge(dirX: number, dirY: number): void {
    if (!this.charge) return
    this.charge.dirX = dirX
    this.charge.dirY = dirY
  }

  /** 0…1 of a full charge */
  get chargeLevel(): number {
    return this.charge ? Math.min(1, this.charge.held / CHARGE_TIME) : 0
  }

  /** Where the boost being charged would send the ship (short look-ahead, recomputed a few times a second). */
  chargePreview(): PropagationResult | null {
    const c = this.charge
    const f = this.flight
    if (!c || !f) return null
    const angle = Math.round((Math.atan2(c.dirY, c.dirX) * 180) / Math.PI / 0.5)
    const key = `${Math.floor(this.t / (this.ctx.hop.flightPace * 0.02))},${angle},${Math.round(this.chargeLevel * 24)}`
    if (this.chargeCache?.key !== key) {
      this.chargeCache = { key, result: f.previewBoost(this.t, c.dirX, c.dirY, this.chargeLevel, this.ctx.hop.previewTime * 0.6) }
    }
    return this.chargeCache.result
  }

  releaseCharge(): boolean {
    const c = this.charge
    const f = this.flight
    const charge = this.chargeLevel
    this.cancelCharge()
    if (!c || !f || this.phase !== 'flight') return false
    const before = f.boostSpent
    const size = f.boostSize(charge) / this.mission.boostMax
    if (!f.boost(this.t, c.dirX, c.dirY, charge)) return false
    const used = f.boostSpent - before
    this.fuel -= used
    this.spent.boost += used
    this.flybyCache = null
    const s = f.stateAt(this.t, this.tmp)
    const len = Math.hypot(c.dirX, c.dirY)
    this.events.push({ kind: 'boost', x: s.x, y: s.y, dirX: c.dirX / len, dirY: c.dirY / len, size })
    return true
  }

  cancelCharge(): void {
    this.charge = null
    this.chargeCache = null
  }

  // ───────────────────────────── the clock

  private flybys(): FlybyRecord[] {
    if (!this.flybyCache && this.flight) this.flybyCache = this.flight.flybys()
    return this.flybyCache ?? []
  }

  /** How fast model time should run in flight right now. */
  private flightScale(): number {
    const f = this.flight!
    const hop = this.ctx.hop
    const { system, firstRock } = this.world
    const s = f.stateAt(this.t, this.tmp)
    let k = 1
    for (let i = 1; i < firstRock; i++) {
      const b = system.bodies[i]
      if (b.mu < GIANT_MU || i === this.target || i === this.origin) continue
      const p = bodyState(system, i, this.t)
      const d = Math.hypot(s.x - p.x, s.y - p.y) / b.influenceRadius
      k = Math.min(k, 0.3 + 0.7 * smooth(0.45, 1.25, d))
    }
    const tp = bodyState(system, this.target, this.t)
    const dt = Math.hypot(s.x - tp.x, s.y - tp.y) / hop.zoneRadius
    k = Math.min(k, 0.4 + 0.6 * smooth(1.2, 3.5, dt))
    // ease in after the launch, hurry up once the ship is well past the reference flight time
    k *= 0.35 + 0.65 * smooth(0, 0.6, this.phaseClock)
    k *= 1 + 2 * smooth(1.2, 1.7, (this.t - f.launchTime) / hop.refFlight)
    if (this.charge) k *= 0.18
    return hop.flightPace * k
  }

  /** Advances the game by `dt` real seconds. */
  update(dt: number): void {
    this.phaseClock += dt
    if (this.charge) this.charge.held += dt
    switch (this.phase) {
      case 'failed':
        if (this.phaseClock > FAIL_PAUSE) {
          if (this.failure?.reason === 'deadline') this.restartMission()
          else this.retryHop()
        }
        return
      case 'complete':
        return
      case 'parked': {
        const pace = this.ctx.hop.parkPace * (this.aiming ? AIM_SLOWDOWN : this.fastForward ? FAST_FORWARD : 1)
        this.timeScale += (pace - this.timeScale) * (1 - Math.exp(-dt * 10))
        this.t += this.timeScale * dt
        this.checkDeadline()
        return
      }
      case 'capture': {
        // the clock runs gently while the ship settles into its parking orbit
        const k = Math.min(this.phaseClock, CAPTURE_TIME) / CAPTURE_TIME
        this.t = this.captureStart + captureDrift(this.ctx.hop.flightPace) * k
        if (this.phaseClock >= CAPTURE_TIME) this.park()
        return
      }
      case 'flight':
        this.updateFlight(dt)
    }
  }

  private updateFlight(dt: number): void {
    const f = this.flight!
    const want = this.flightScale()
    this.timeScale += (want - this.timeScale) * (1 - Math.exp(-dt * (this.charge ? 14 : 5)))
    const end = f.end
    this.t = Math.min(end.t, this.t + this.timeScale * dt)
    this.announceFlybys()
    if (this.checkDeadline()) return
    if (this.t >= end.t) this.finishHop()
  }

  private checkDeadline(): boolean {
    const d = this.mission.deadline
    if (d === null || this.t <= d || this.phase === 'failed') return false
    const s = this.flight && this.phase === 'flight' ? this.flight.stateAt(this.t, this.tmp) : bodyState(this.world.system, this.origin, this.t)
    this.fail('deadline', null, s.x, s.y, 0)
    return true
  }

  private announceFlybys(): void {
    const { system } = this.world
    for (const fb of this.flybys()) {
      if (fb.bodyIndex === this.target || fb.bodyIndex === this.origin) continue
      const key = `${fb.bodyIndex}@${fb.tIn.toFixed(5)}`
      if (this.t >= fb.tIn && !this.entered.has(key)) {
        this.entered.add(key)
        if (system.bodies[fb.bodyIndex].mu >= GIANT_MU) this.events.push({ kind: 'flybyIn', bodyIndex: fb.bodyIndex })
      }
      if (fb.complete && this.t >= fb.tOut && !this.announced.has(key)) {
        this.announced.add(key)
        const gain = slingshotGain(fb)
        if (Math.abs(gain) < SLINGSHOT_MIN_KMS) continue
        this.combo++
        const p = bodyState(system, fb.bodyIndex, this.t)
        this.events.push({
          kind: 'slingshot', bodyIndex: fb.bodyIndex, gainKms: gain, combo: this.combo,
          close: fb.distance < system.bodies[fb.bodyIndex].radius * CLOSE_PASS_RADII, x: p.x, y: p.y,
        })
      }
    }
  }

  private fail(reason: FailReason, bodyIndex: number | null, x: number, y: number, need: number): void {
    this.phase = 'failed'
    this.phaseClock = 0
    this.charge = null
    this.failures++
    this.failure = { kind: 'failed', reason, bodyIndex, x, y, need }
    this.events.push(this.failure)
  }

  private finishHop(): void {
    const f = this.flight!
    const end = f.end
    const s = f.stateAt(end.t, this.tmp)
    this.charge = null
    if (end.reason !== 'arrived') {
      this.fail(end.reason, end.bodyIndex, s.x, s.y, 0)
      return
    }
    const cost = f.captureCost ?? 0
    if (cost > this.fuel + 1e-12) {
      this.fail('fuel', this.target, s.x, s.y, cost - this.fuel)
      return
    }
    this.fuel -= cost
    this.spent.capture += cost
    this.phase = 'capture'
    this.phaseClock = 0
    this.captureStart = this.t
    const last = this.hopIndex === this.mission.hops.length - 1
    this.events.push({ kind: 'captured', bodyIndex: this.target, cost, x: s.x, y: s.y, last })
  }

  /** The capture is over: park at the new planet and start the next window clock, or finish the mission. */
  private park(): void {
    this.hopCosts[this.hopIndex] = this.totalSpent - totalSpent(this.checkpoint.spent)
    if (this.hopIndex === this.mission.hops.length - 1) {
      this.phase = 'complete'
      this.phaseClock = 0
      const spent = this.totalSpent
      this.result = { stars: starsFor(this.mission, spent), spent }
      this.events.push({ kind: 'complete', ...this.result })
      return
    }
    this.hopIndex++
    this.flight = null
    this.ghost = null
    this.attempts = 0
    this.failures = 0
    this.phase = 'parked'
    this.phaseClock = 0
    this.timeScale = 0
    this.checkpoint = { t: this.t, fuel: this.fuel, spent: { ...this.spent } }
    this.forecastCache = null
  }

  // ───────────────────────────── reading the state

  /** The ship's state: in flight from the flight, otherwise riding with its planet. */
  ship(out: ShipSample = this.tmp): ShipSample {
    if (this.flight && (this.phase === 'flight' || this.phase === 'failed')) return this.flight.stateAt(this.t, out)
    const body = this.phase === 'capture' || this.phase === 'complete' ? this.target : this.origin
    const p = bodyState(this.world.system, body, this.t)
    out.t = this.t
    out.x = p.x
    out.y = p.y
    out.vx = p.vx
    out.vy = p.vy
    return out
  }

  speedKms(): number {
    const s = this.ship()
    return toKms(Math.hypot(s.vx, s.vy))
  }

  /** The hop flown so far as x,y pairs (segments cut at the boosts), filled in between coarse cruise steps. */
  flownPath(): Float32Array {
    const f = this.flight
    if (!f) return new Float32Array(0)
    const pts: number[] = []
    const st = newSample()
    const gap = 0.015
    f.segments.forEach((seg, i) => {
      const r = seg.result
      const until = Math.min(i + 1 < f.segments.length ? f.segments[i + 1].t0 : Infinity, this.t, r.endTime)
      if (until < seg.t0) return
      let prevT = NaN
      let prevX = 0
      let prevY = 0
      // long cruise steps: points along the interpolating cubic keep the trail a curve
      const add = (t: number, x: number, y: number) => {
        const n = Number.isNaN(prevT) ? 0 : Math.floor(Math.hypot(x - prevX, y - prevY) / gap)
        for (let j = 1; j <= n; j++) {
          sampleTrajectory(r.samples, r.sampleCount, prevT + ((t - prevT) * j) / (n + 1), st)
          pts.push(st.x, st.y)
        }
        pts.push(x, y)
        prevT = t
        prevX = x
        prevY = y
      }
      for (let k = 0; k < r.sampleCount; k++) {
        const tk = r.samples[k * SAMPLE_STRIDE]
        if (tk >= until) break
        add(tk, r.samples[k * SAMPLE_STRIDE + 1], r.samples[k * SAMPLE_STRIDE + 2])
      }
      sampleTrajectory(r.samples, r.sampleCount, until, st)
      add(until, st.x, st.y)
    })
    return new Float32Array(pts)
  }

  /** Takes this frame's events. */
  drain(): GameEvent[] {
    const e = this.events
    this.events = []
    return e
  }
}
