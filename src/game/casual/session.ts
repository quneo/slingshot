import { newSample, SAMPLE_STRIDE, sampleTrajectory, type ShipSample } from '../physics/interpolate'
import type { FlybyRecord, PropagationResult } from '../physics/propagate'
import { bodyState } from '../physics/system'
import { toKms } from '../physics/units'
import { isClosePass, scoreFlight, slingshotGain, SLINGSHOT_MIN_KMS, type FlightScore } from './scoring'
import { Flight, previewPath, type EndReason } from './sim'
import type { CasualLevel } from './types'
import { buildWorld, type CasualWorld } from './world'

export type Phase = 'aim' | 'flight' | 'arrived' | 'failed'

/** Things that happened this frame: the renderer turns them into particles and popups, the audio into sounds. */
export type GameEvent =
  | { kind: 'launch'; power: number }
  | { kind: 'boost'; x: number; y: number; dirX: number; dirY: number; size: number }
  | { kind: 'dust'; index: number; x: number; y: number; count: number }
  | { kind: 'flybyIn'; bodyIndex: number }
  | { kind: 'slingshot'; bodyIndex: number; gainKms: number; combo: number; close: boolean; x: number; y: number }
  | { kind: 'arrived'; x: number; y: number; stars: number }
  | { kind: 'failed'; reason: Exclude<EndReason, 'arrived'>; bodyIndex: number | null; x: number; y: number }

/** Real seconds a boost takes to charge fully. */
export const CHARGE_TIME = 0.75
/** After a failed attempt, the next aim starts by itself after this many real seconds. */
export const FAIL_PAUSE = 1.5
/** Planets heavier than this bend the path visibly: slow motion and a "flyby" moment near them. */
const GIANT_MU = 1e-3

const smooth = (a: number, b: number, x: number) => {
  const k = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return k * k * (3 - 2 * k)
}

/**
 * One level being played: aiming, the live flight, boosts and the outcome. Pure game logic (no canvas, no DOM):
 * the controller feeds it real time and input, the renderer and audio read its state and events.
 */
export class Session {
  readonly world: CasualWorld
  phase: Phase = 'aim'
  flight: Flight | null = null
  /** model time of the flight */
  t = 0
  /** real seconds since the phase began */
  phaseClock = 0
  /** current playback speed, model time per real second (smoothed) */
  timeScale = 0
  /** pull of the slingshot as a launch Δv, null when not aiming */
  aim: { dvx: number; dvy: number } | null = null
  /** previous attempt: the launch and the path flown, for the ghost */
  ghost: { launch: { dvx: number; dvy: number }; path: Float32Array } | null = null
  /** boost being charged: direction in world coordinates and real seconds held */
  charge: { dirX: number; dirY: number; held: number } | null = null
  score: FlightScore | null = null
  failure: Extract<GameEvent, { kind: 'failed' }> | null = null
  attempts = 0
  failures = 0
  events: GameEvent[] = []

  private flybyCache: FlybyRecord[] | null = null
  private entered = new Set<string>()
  private announced = new Set<string>()
  private combo = 0
  private previewCache: { key: string; result: PropagationResult } | null = null
  private chargeCache: { key: string; result: PropagationResult | null } | null = null
  private readonly tmp = newSample()

  constructor(readonly level: CasualLevel) {
    this.world = buildWorld(level)
  }

  // ───────────────────────────── aiming

  setAim(dvx: number, dvy: number): void {
    if (this.phase !== 'aim') return
    const m = Math.hypot(dvx, dvy)
    const k = m > this.level.power ? this.level.power / m : 1
    this.aim = { dvx: dvx * k, dvy: dvy * k }
  }

  clearAim(): void {
    this.aim = null
  }

  /** The start of the path for the current pull (cached). */
  preview(): PropagationResult | null {
    if (!this.aim) return null
    const q = this.level.power / 1500
    const key = `${Math.round(this.aim.dvx / q)},${Math.round(this.aim.dvy / q)}`
    if (this.previewCache?.key !== key) {
      this.previewCache = { key, result: previewPath(this.level, this.world, this.aim.dvx, this.aim.dvy, this.level.previewTime) }
    }
    return this.previewCache.result
  }

  launch(): boolean {
    if (this.phase !== 'aim' || !this.aim) return false
    const { dvx, dvy } = this.aim
    if (Math.hypot(dvx, dvy) < this.level.power * 0.08) return false
    this.flight = new Flight(this.level, { dvx, dvy }, this.world)
    this.phase = 'flight'
    this.phaseClock = 0
    this.t = 0
    this.timeScale = this.level.pace * 0.3
    this.attempts++
    this.flybyCache = null
    this.entered.clear()
    this.announced.clear()
    this.combo = 0
    this.score = null
    this.failure = null
    this.events.push({ kind: 'launch', power: Math.hypot(dvx, dvy) / this.level.power })
    this.aim = null
    return true
  }

  /** Back to aiming; the attempt in progress (if any) becomes the ghost. */
  reset(): void {
    if (this.flight) this.ghost = { launch: this.flight.launch, path: this.flownPath() }
    this.flight = null
    this.phase = 'aim'
    this.phaseClock = 0
    this.t = 0
    this.charge = null
    this.chargeCache = null
    this.aim = null
    this.score = null
    this.failure = null
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

  /** Where the boost being charged would send the ship (short look-ahead, cached per frame). */
  chargePreview(): PropagationResult | null {
    const c = this.charge
    const f = this.flight
    if (!c || !f) return null
    // coarse key: the look-ahead is recomputed a few times a second, not every frame (a phone can't afford that);
    // steps of 1/24 charge, ½° and a sliver of flight time are below what the eye can tell apart
    const angle = Math.round((Math.atan2(c.dirY, c.dirX) * 180) / Math.PI / 0.5)
    const key = `${Math.floor(this.t / (this.level.pace * 0.02))},${angle},${Math.round(this.chargeLevel * 24)}`
    if (this.chargeCache?.key !== key) {
      this.chargeCache = { key, result: f.previewBoost(this.t, c.dirX, c.dirY, this.chargeLevel, this.level.previewTime * 0.6) }
    }
    return this.chargeCache.result
  }

  releaseCharge(): boolean {
    const c = this.charge
    const f = this.flight
    const charge = this.chargeLevel
    this.cancelCharge()
    if (!c || !f || this.phase !== 'flight') return false
    const size = f.boostSize(charge) / this.level.boostMax
    if (!f.boost(this.t, c.dirX, c.dirY, charge)) return false
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

  /** How fast model time should run right now. */
  private targetScale(): number {
    const f = this.flight!
    const { system, targetIndex, firstRock } = this.world
    const s = f.stateAt(this.t, this.tmp)
    let k = 1
    for (let i = 1; i < firstRock; i++) {
      const b = system.bodies[i]
      if (b.mu < GIANT_MU || i === targetIndex) continue
      const p = bodyState(system, i, this.t)
      const d = Math.hypot(s.x - p.x, s.y - p.y) / b.influenceRadius
      k = Math.min(k, 0.3 + 0.7 * smooth(0.45, 1.25, d))
    }
    const tp = bodyState(system, targetIndex, this.t)
    const dt = Math.hypot(s.x - tp.x, s.y - tp.y) / this.level.target.zoneRadius
    k = Math.min(k, 0.45 + 0.55 * smooth(1.2, 3, dt))
    // ease in after the launch, hurry up once the ship is well past the reference arrival
    k *= 0.35 + 0.65 * smooth(0, 0.6, this.phaseClock)
    k *= 1 + 2 * smooth(1.15, 1.6, this.t / this.level.refTime)
    if (this.charge) k *= 0.18
    return this.level.pace * k
  }

  /** Advances the game by `dt` real seconds. */
  update(dt: number): void {
    this.phaseClock += dt
    if (this.charge) this.charge.held += dt
    if (this.phase === 'failed' && this.phaseClock > FAIL_PAUSE) this.reset()
    if (this.phase !== 'flight' || !this.flight) return
    const f = this.flight

    const want = this.targetScale()
    this.timeScale += (want - this.timeScale) * (1 - Math.exp(-dt * (this.charge ? 14 : 5)))
    const t0 = this.t
    const end = f.end
    this.t = Math.min(end.t, this.t + this.timeScale * dt)

    for (const i of f.collect(t0, this.t)) {
      const [x, y] = this.level.stardust[i]
      this.events.push({ kind: 'dust', index: i, x, y, count: f.collected.filter(Boolean).length })
    }
    this.announceFlybys()

    if (this.t >= end.t) this.finish()
  }

  private announceFlybys(): void {
    const { system, targetIndex } = this.world
    for (const fb of this.flybys()) {
      if (fb.bodyIndex === targetIndex) continue
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
          close: isClosePass(this.flight!, fb), x: p.x, y: p.y,
        })
      }
    }
  }

  private finish(): void {
    const f = this.flight!
    const end = f.end
    const s = f.stateAt(end.t, this.tmp)
    this.charge = null
    this.phaseClock = 0
    if (end.reason === 'arrived') {
      this.phase = 'arrived'
      this.score = scoreFlight(f)
      this.events.push({ kind: 'arrived', x: s.x, y: s.y, stars: this.score.stars })
    } else {
      this.phase = 'failed'
      this.failures++
      this.failure = { kind: 'failed', reason: end.reason, bodyIndex: end.bodyIndex, x: s.x, y: s.y }
      this.events.push(this.failure)
    }
  }

  // ───────────────────────────── reading the state

  ship(out: ShipSample = this.tmp): ShipSample | null {
    if (!this.flight) return null
    return this.flight.stateAt(this.t, out)
  }

  speedKms(): number {
    const s = this.ship()
    return s ? toKms(Math.hypot(s.vx, s.vy)) : 0
  }

  /** The path flown so far as x,y pairs (segments cut at the boosts), filled in between coarse cruise steps. */
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
