/**
 * Builds the missions: places the planets, finds the launch windows and the reference plan for every hop, sizes the
 * tank and the stars, verifies the whole plan with the game's own Session and writes src/game/casual/levels.ts.
 *   npx tsx tools/mission-build.ts [id]      (no id = all; writes the file only when every mission passes)
 *
 * Per hop:
 *  - a target marked `phase: 'auto'` is placed so that a Hohmann transfer opens `windowAfter` after parking;
 *    with `via`, the designer's throw is flown and the helper giant, then the target, are put on its path;
 *  - the window is searched with Lambert's problem around the star (a porkchop over wait × flight time), then the
 *    best few candidates are refined with the real propagator (planets pull too) by Nelder–Mead on (wait, Δv).
 */
import { writeFileSync } from 'node:fs'
import { CATALOG, type BodyId } from '../src/game/levels/catalog'
import { captureDrift, Session } from '../src/game/casual/session'
import { captureCost, flyHop, hopContext, type HopContext } from '../src/game/casual/sim'
import type { Asteroid, Hop, Mission } from '../src/game/casual/types'
import { buildWorld, freeCaptureSpeed, launchState, type CasualWorld } from '../src/game/casual/world'
import { newSample, sampleTrajectory, SAMPLE_STRIDE } from '../src/game/physics/interpolate'
import { bodyState } from '../src/game/physics/system'
import { toDays, toKms } from '../src/game/physics/units'
import { lambert } from '../src/game/physics/lambert'

const DEG = Math.PI / 180

interface HopDraft {
  to: BodyId
  zone: number
  /** for an auto-placed target: the Hohmann window opens this long after parking (model time) */
  windowAfter?: number
  /** a slingshot hop: fly this throw `wait` after parking, put `id` on the path (offset along its orbit), then the target */
  via?: { id: BodyId; offset: number; mag: number; angleDeg: number; wait: number }
  /** the window search looks this far ahead after parking (model time) */
  maxWait?: number
  /** forecast length as a share of the reference flight (≥ 1: the whole hop) */
  preview?: number
}

interface Draft {
  id: string
  chapter: number
  title: string
  goal: string
  hint: string
  start: BodyId
  bodies: { id: BodyId; phase: number | 'auto' }[]
  hops: HopDraft[]
  /** tank = reference Δv × this */
  fuelFactor: number
  /** deadline = reference mission time × this (none if omitted) */
  deadlineFactor?: number
  belt?: { radius: number; count: number; spread: number; rock: number; centerDeg: number }
}

const b = (id: BodyId, phase: number | 'auto' = 'auto') => ({ id, phase })

export const DRAFTS: Draft[] = [
  // ── Глава 1: окна старта
  {
    id: 'm1',
    chapter: 1,
    title: 'Первое окно',
    goal: 'Перелети с Аквы на Рубру',
    hint: 'Тяни, пока путь не дотянется до орбиты Рубры, и жди: отпускай, когда призрак Рубры встретит путь',
    start: 'aqua',
    bodies: [b('cinder', 40), b('aqua', 200), b('rubra'), b('colossus', 300), b('aurum', 120)],
    hops: [{ to: 'rubra', zone: 0.16, windowAfter: 2.2 }],
    fuelFactor: 1.8,
  },
  {
    id: 'm2',
    chapter: 1,
    title: 'Вниз, к Пеплу',
    goal: 'Спустись с Аквы на Пепел',
    hint: 'К звезде — значит тормозить: тяни вперёд по ходу Аквы, корабль полетит назад и упадёт внутрь',
    start: 'aqua',
    bodies: [b('cinder'), b('aqua', 60), b('rubra', 250), b('colossus', 150), b('aurum', 20)],
    hops: [{ to: 'cinder', zone: 0.11, windowAfter: 1.4 }],
    fuelFactor: 1.7,
  },
  {
    id: 'm3',
    chapter: 1,
    title: 'Туда и обратно',
    goal: 'Аква → Рубра → домой, на Акву',
    hint: 'Обратное окно откроется не сразу: перемотай время ⏩ и лови момент',
    start: 'aqua',
    bodies: [b('cinder', 300), b('aqua', 90), b('rubra'), b('colossus', 200), b('aurum', 330)],
    hops: [
      { to: 'rubra', zone: 0.16, windowAfter: 1.6 },
      { to: 'aqua', zone: 0.16, maxWait: 14 },
    ],
    fuelFactor: 1.55,
  },
  {
    id: 'm4',
    chapter: 1,
    title: 'Лестница',
    goal: 'Пепел → Аква → Рубра',
    hint: 'Каждый прыжок — своё окно. Топливо общее на всю миссию',
    start: 'cinder',
    bodies: [b('cinder', 10), b('aqua'), b('rubra'), b('colossus', 60), b('aurum', 250)],
    hops: [
      { to: 'aqua', zone: 0.15, windowAfter: 1.0 },
      { to: 'rubra', zone: 0.16, windowAfter: 2.5 },
    ],
    fuelFactor: 1.45,
  },
  // ── Глава 2: гиганты
  {
    id: 'm5',
    chapter: 2,
    title: 'К Колоссу',
    goal: 'Долети до Колосса',
    hint: 'Гигант ловит корабль сам — захват бесплатный. Дорог только старт',
    start: 'aqua',
    bodies: [b('cinder', 120), b('aqua', 330), b('rubra', 80), b('colossus'), b('aurum', 200), b('borey', 40)],
    hops: [{ to: 'colossus', zone: 0.3, windowAfter: 2.0 }],
    fuelFactor: 1.4,
  },
  {
    id: 'm6',
    chapter: 2,
    title: 'Праща',
    goal: 'До Аурума через Колосс',
    hint: 'Напрямую топлива не хватит. Пролети позади Колосса — он разгонит бесплатно',
    start: 'aqua',
    bodies: [b('cinder', 200), b('aqua', 160), b('rubra', 20), b('colossus'), b('aurum'), b('borey', 300)],
    hops: [{ to: 'aurum', zone: 0.3, via: { id: 'colossus', offset: 0.07, mag: 0.23, angleDeg: 0, wait: 1.8 }, maxWait: 3 }],
    fuelFactor: 1.15,
  },
  {
    id: 'm7',
    chapter: 2,
    title: 'Обратный ход',
    goal: 'Аква → Колосс → Рубра',
    hint: 'С гиганта к маленькой Рубре дорого тормозить: ищи окно, где подлетаешь медленно',
    start: 'aqua',
    bodies: [b('cinder', 0), b('aqua', 100), b('rubra'), b('colossus'), b('aurum', 300), b('borey', 180)],
    hops: [
      { to: 'colossus', zone: 0.3, windowAfter: 1.5 },
      { to: 'rubra', zone: 0.16, windowAfter: 2.0 },
    ],
    fuelFactor: 1.35,
  },
  {
    id: 'm8',
    chapter: 2,
    title: 'Сквозь пояс',
    goal: 'Проскочи пояс астероидов к Колоссу',
    hint: 'Камни летят по своей орбите: выбери окно, когда в поясе есть просвет',
    start: 'aqua',
    bodies: [b('cinder', 60), b('aqua', 260), b('rubra', 150), b('colossus'), b('aurum', 90)],
    hops: [{ to: 'colossus', zone: 0.3, windowAfter: 2.2, maxWait: 5 }],
    fuelFactor: 1.35,
    belt: { radius: 1.95, count: 16, spread: 150, rock: 0.05, centerDeg: 0 },
  },
  // ── Глава 3: экспедиция
  {
    id: 'm9',
    chapter: 3,
    title: 'Три прыжка',
    goal: 'Аква → Рубра → Колосс → Аурум',
    hint: 'Длинная дорога: сэкономь на первых прыжках — пригодится в конце',
    start: 'aqua',
    bodies: [b('cinder', 100), b('aqua', 20), b('rubra'), b('colossus'), b('aurum'), b('borey', 230)],
    hops: [
      { to: 'rubra', zone: 0.16, windowAfter: 1.5 },
      { to: 'colossus', zone: 0.3, windowAfter: 2.5 },
      { to: 'aurum', zone: 0.3, windowAfter: 3 },
    ],
    fuelFactor: 1.3,
  },
  {
    id: 'm10',
    chapter: 3,
    title: 'К Борею',
    goal: 'Аква → Колосс → Борей, успей к сроку',
    hint: 'Срок жёсткий: долго ждать идеального окна нельзя',
    start: 'aqua',
    bodies: [b('cinder', 280), b('aqua', 45), b('rubra', 200), b('colossus'), b('aurum', 100), b('borey')],
    hops: [
      { to: 'colossus', zone: 0.3, windowAfter: 1.2 },
      { to: 'borey', zone: 0.3, windowAfter: 2 },
    ],
    fuelFactor: 1.3,
    deadlineFactor: 1.15,
  },
  {
    id: 'm11',
    chapter: 3,
    title: 'Домой с гиганта',
    goal: 'Аква → Колосс → снова Аква',
    hint: 'Возвращаться к маленькой Акве — значит гасить скорость. Выбирай окно с умом',
    start: 'aqua',
    bodies: [b('cinder', 170), b('aqua', 300), b('rubra', 60), b('colossus'), b('aurum', 240), b('borey', 10)],
    hops: [
      { to: 'colossus', zone: 0.3, windowAfter: 1.4 },
      { to: 'aqua', zone: 0.16, maxWait: 10 },
    ],
    fuelFactor: 1.3,
    deadlineFactor: 1.3,
  },
  {
    id: 'm12',
    chapter: 3,
    title: 'Гранд-тур',
    goal: 'Колосс, Аурум, Борей — и к Виоле',
    hint: 'Четыре окна, один бак, жёсткий срок. Удачи, пилот',
    start: 'aqua',
    bodies: [b('cinder', 30), b('aqua', 210), b('rubra', 120), b('colossus'), b('aurum'), b('borey'), b('viola')],
    hops: [
      { to: 'colossus', zone: 0.3, windowAfter: 1.2 },
      { to: 'aurum', zone: 0.3, windowAfter: 2 },
      { to: 'borey', zone: 0.3, windowAfter: 2.5 },
      { to: 'viola', zone: 0.28, windowAfter: 3 },
    ],
    fuelFactor: 1.25,
    deadlineFactor: 1.15,
  },
]

export const CHAPTERS = [
  { number: 1, title: 'Окна старта', starsToOpen: 0 },
  { number: 2, title: 'Гиганты', starsToOpen: 6 },
  { number: 3, title: 'Экспедиция', starsToOpen: 14 },
]

// ───────────────────────────────────────── helpers

const round = (v: number, digits = 5) => Math.round(v * 10 ** digits) / 10 ** digits
const meanMotion = (id: BodyId) => Math.pow(CATALOG[id].orbitRadius!, -1.5)
const hohmannTime = (a: BodyId, c: BodyId) => Math.PI * Math.pow((CATALOG[a].orbitRadius! + CATALOG[c].orbitRadius!) / 2, 1.5)

/** The reference aims at the inner part of the target ring, so that a near miss in play still arrives. */
const ZONE_MARGIN = 0.6
/** No years-long drifting transfers: a reference hop takes at most this many Hohmann times. */
const FLIGHT_LIMIT = 1.35
/**
 * Δv for three and for two stars: a little over the reference, never more than the tank's slack allows
 * (on a tight tank, two stars still mean flying better than "just made it").
 */
export const starThresholds = (ref: number, fuel: number): [number, number] => [
  round(ref + Math.min(0.08 * ref, 0.35 * (fuel - ref))),
  round(ref + Math.min(0.25 * ref, 0.75 * (fuel - ref))),
]

/** A reference hop plays in about this many real seconds at cruise speed. */
const FLIGHT_SECONDS = 5

/** A mission skeleton (no references yet) for flying hops while it is being built. */
function skeleton(d: Draft, phases: Map<BodyId, number>, asteroids: Asteroid[], zoneScale = 1): Mission {
  return {
    id: d.id, chapter: d.chapter, number: 0, title: d.title, goal: d.goal, hint: d.hint,
    bodies: d.bodies.map((x) => ({ id: x.id, phaseDeg: phases.get(x.id) ?? 0 })),
    start: d.start,
    hops: d.hops.map((h) => ({
      to: h.to, zoneRadius: h.zone * zoneScale, maxFlight: 200, previewTime: 200, parkPace: 1, flightPace: 1,
      reference: { wait: 0, dvx: 0, dvy: 0 }, refFlight: 1, refCost: 0, view: { x: 0, y: 0, radius: 3 },
    })),
    asteroids, fuel: 100, power: 100, boostMax: 0.01, refCost: 0, stars: [100, 100], deadline: null,
  }
}

/** World where planets not placed yet do nothing (no gravity, no surface). */
function worldWithout(m: Mission, pending: Set<BodyId>): CasualWorld {
  const w = buildWorld(m)
  w.system.bodies.forEach((body, i) => {
    const id = w.planetOf[i]
    if (id && pending.has(id)) {
      body.mu = 0
      body.radius = 0
      body.influenceRadius = 0
    }
  })
  return w
}

interface Plan {
  wait: number
  dvx: number
  dvy: number
}

interface Outcome {
  arrived: boolean
  cost: number
  flight: number
  miss: number
}

function flyPlan(ctx: HopContext, t0: number, p: Plan, maxFlight: number): Outcome {
  const t = t0 + p.wait
  const r = flyHop(ctx, t, launchState(ctx.world, ctx.origin, t, p.dvx, p.dvy), true, t + maxFlight)
  const launch = Math.hypot(p.dvx, p.dvy)
  if (r.endReason === 'arrived' && r.arrival) {
    return { arrived: true, cost: launch + captureCost(ctx, r.arrival.relSpeed), flight: r.endTime - t, miss: 0 }
  }
  const c = r.closest[ctx.target]
  return { arrived: false, cost: launch, flight: r.endTime - t, miss: c ? c.distance - ctx.hop.zoneRadius : 9 }
}

/** Nelder–Mead in n dimensions. */
function nelderMead(f: (x: number[]) => number, x0: number[], step: number[], iters: number): { x: number[]; f: number } {
  const n = x0.length
  let pts = [x0, ...step.map((s, i) => x0.map((v, j) => (j === i ? v + s : v)))]
  let vals = pts.map(f)
  for (let it = 0; it < iters; it++) {
    const order = vals.map((v, i) => [v, i]).sort((a, c) => a[0] - c[0]).map((x) => x[1])
    pts = order.map((i) => pts[i])
    vals = order.map((i) => vals[i])
    const centroid = x0.map((_, j) => pts.slice(0, n).reduce((s, p) => s + p[j], 0) / n)
    const towards = (k: number) => centroid.map((c, j) => c + k * (pts[n][j] - c))
    const xr = towards(-1)
    const fr = f(xr)
    if (fr < vals[0]) {
      const xe = towards(-2)
      const fe = f(xe)
      if (fe < fr) [pts[n], vals[n]] = [xe, fe]
      else [pts[n], vals[n]] = [xr, fr]
    } else if (fr < vals[n - 1]) [pts[n], vals[n]] = [xr, fr]
    else {
      const xc = towards(0.5)
      const fc = f(xc)
      if (fc < vals[n]) [pts[n], vals[n]] = [xc, fc]
      else {
        pts = pts.map((p, i) => (i === 0 ? p : p.map((v, j) => pts[0][j] + 0.5 * (v - pts[0][j]))))
        vals = pts.map((p, i) => (i === 0 ? vals[0] : f(p)))
      }
    }
  }
  const best = vals.indexOf(Math.min(...vals))
  return { x: pts[best], f: vals[best] }
}

/** Refines a plan with the real propagator: the cheapest arrival near the guess. */
function refine(ctx: HopContext, t0: number, guess: Plan, maxWait: number, maxFlight: number): { plan: Plan; out: Outcome } {
  const scale = Math.max(0.02, Math.hypot(guess.dvx, guess.dvy))
  const clampWait = (w: number) => Math.min(maxWait, Math.max(0, w))
  const J = (x: number[]) => {
    const o = flyPlan(ctx, t0, { wait: clampWait(x[0]), dvx: x[1], dvy: x[2] }, maxFlight)
    return o.arrived ? o.cost : o.cost + 1 + o.miss * 4
  }
  let x = [guess.wait, guess.dvx, guess.dvy]
  let fx = J(x)
  for (const s of [0.08, 0.02, 0.005]) {
    const r = nelderMead(J, x, [Math.max(0.05, maxWait * s), scale * s, scale * s], 140)
    if (r.f < fx) {
      x = r.x
      fx = r.f
    }
  }
  const plan = { wait: clampWait(x[0]), dvx: x[1], dvy: x[2] }
  return { plan, out: flyPlan(ctx, t0, plan, maxFlight) }
}

/** Porkchop with Lambert around the star: the cheapest local minima over the wait, as first guesses. */
function porkchop(ctx: HopContext, t0: number, maxWait: number, maxTof: number): { cost: number; plan: Plan }[] {
  const sys = ctx.world.system
  const vfree = freeCaptureSpeed(ctx.world, ctx.target, ctx.hop.zoneRadius)
  const cands: { cost: number; plan: Plan }[] = []
  const nW = 90
  for (let i = 0; i <= nW; i++) {
    const wait = (maxWait * i) / nW
    const a = bodyState(sys, ctx.origin, t0 + wait)
    let best: { cost: number; plan: Plan } | null = null
    for (let tof = 0.25; tof <= maxTof; tof *= 1.03) {
      const bt = bodyState(sys, ctx.target, t0 + wait + tof)
      const L = lambert(a.x, a.y, bt.x, bt.y, tof)
      if (!L) continue
      const dvx = L.v1x - a.vx
      const dvy = L.v1y - a.vy
      const cost = Math.hypot(dvx, dvy) + Math.max(0, Math.hypot(L.v2x - bt.vx, L.v2y - bt.vy) - vfree)
      if (!best || cost < best.cost) best = { cost, plan: { wait, dvx, dvy } }
    }
    if (best) cands.push(best)
  }
  const minima = cands.filter((c, i) => (i === 0 || c.cost <= cands[i - 1].cost) && (i === cands.length - 1 || c.cost <= cands[i + 1].cost))
  return minima.sort((x, y) => x.cost - y.cost).slice(0, 3)
}

/** Where the path first crosses circle r (after time `after`): time and polar angle. */
function crossing(ctx: HopContext, t0: number, p: Plan, r: number, maxFlight: number, after = -Infinity): { t: number; angle: number } | null {
  const t = t0 + p.wait
  const res = flyHop(ctx, t, launchState(ctx.world, ctx.origin, t, p.dvx, p.dvy), true, t + maxFlight)
  const s = res.samples
  const st = newSample()
  for (let k = 1; k < res.sampleCount; k++) {
    const ta = s[(k - 1) * SAMPLE_STRIDE]
    const tb = s[k * SAMPLE_STRIDE]
    if (tb < after) continue
    const ra = Math.hypot(s[(k - 1) * SAMPLE_STRIDE + 1], s[(k - 1) * SAMPLE_STRIDE + 2])
    const rb = Math.hypot(s[k * SAMPLE_STRIDE + 1], s[k * SAMPLE_STRIDE + 2])
    if ((ra - r) * (rb - r) <= 0 && ra !== rb) {
      let lo = ta
      let hi = tb
      for (let i = 0; i < 40; i++) {
        const mid = (lo + hi) / 2
        sampleTrajectory(s, res.sampleCount, mid, st)
        if ((Math.hypot(st.x, st.y) - r) * (ra - r) > 0) lo = mid
        else hi = mid
      }
      sampleTrajectory(s, res.sampleCount, hi, st)
      return { t: hi, angle: Math.atan2(st.y, st.x) }
    }
  }
  return null
}

/** A throw `mag` at `angleDeg` from the planet's direction of motion (+ = away from the star), `wait` after t0. */
function throwAlong(w: CasualWorld, origin: number, t0: number, v: { mag: number; angleDeg: number; wait: number }): Plan {
  const o = bodyState(w.system, origin, t0 + v.wait)
  const sp = Math.hypot(o.vx, o.vy)
  const ux = o.vx / sp
  const uy = o.vy / sp
  const r = Math.hypot(o.x, o.y)
  // a +90° turn of the velocity points towards or away from the star depending on the sense of the orbit
  const side = (o.x / r) * -uy + (o.y / r) * ux >= 0 ? 1 : -1
  const a = v.angleDeg * DEG
  return { wait: v.wait, dvx: v.mag * (ux * Math.cos(a) - side * uy * Math.sin(a)), dvy: v.mag * (uy * Math.cos(a) + side * ux * Math.sin(a)) }
}

// ───────────────────────────────────────── building one mission

interface HopSetup {
  origin: BodyId
  hohmann: number
  /** the reference may fly at most this long */
  searchFlight: number
  maxWait: number
}

function setup(d: Draft, k: number): HopSetup {
  const h = d.hops[k]
  const origin = k === 0 ? d.start : d.hops[k - 1].to
  const hohmann = hohmannTime(origin, h.to)
  return { origin, hohmann, searchFlight: hohmann * FLIGHT_LIMIT + 0.3, maxWait: h.maxWait ?? Math.max(3, (h.windowAfter ?? 0) * 2.5) }
}

/** The cheapest arriving plan for hop k starting at t0 (porkchop guesses + an optional prior guess, refined). */
function planHop(d: Draft, m: Mission, w: CasualWorld, k: number, t0: number, prior: Plan | null): { plan: Plan; out: Outcome } | null {
  const su = setup(d, k)
  const ctx = hopContext(m, w, k)
  const guesses = porkchop(ctx, t0, su.maxWait, su.searchFlight).map((c) => c.plan)
  if (prior) guesses.unshift(prior)
  let best: { plan: Plan; out: Outcome } | null = null
  for (const g of guesses) {
    const r = refine(ctx, t0, g, su.maxWait, su.searchFlight)
    if (r.out.arrived && (!best || r.out.cost < best.out.cost)) best = r
    // a slingshot hop keeps the designer's route
    if (d.hops[k].via && best) break
  }
  return best
}

/** Next window clock after a hop flown for `flight`: the capture moment lets the clock run on a little. */
const nextStart = (t0: number, plan: Plan, flight: number) => t0 + plan.wait + flight + captureDrift(round(flight / FLIGHT_SECONDS))

/**
 * The flight time the game will see: it counts arrival at the edge of the full ring (the reference was planned for
 * the inner part of it), so the next hop's clock and the cruise pace follow this one.
 */
function gameFlight(d: Draft, phases: Map<BodyId, number>, pending: Set<BodyId>, k: number, t0: number, plan: Plan): number {
  const m = skeleton(d, phases, [])
  const ctx = hopContext(m, worldWithout(m, pending), k)
  const o = flyPlan(ctx, t0, plan, setup(d, k).searchFlight * 1.5)
  if (!o.arrived) throw new Error(`hop ${k + 1}: the plan misses the full ring`)
  return o.flight
}

export function build(d: Draft, number: number): { mission: Mission; report: string } {
  const phases = new Map<BodyId, number>()
  const pending = new Set<BodyId>()
  for (const x of d.bodies) {
    if (x.phase === 'auto') pending.add(x.id)
    else phases.set(x.id, x.phase)
  }
  if (pending.has(d.start)) throw new Error('the start planet needs a phase')

  // ── pass 1: put the planets where the windows should be, hop by hop
  const pass1: Plan[] = []
  let t0 = 0
  d.hops.forEach((h, k) => {
    const su = setup(d, k)
    if (h.via) {
      const v = h.via
      const m0 = skeleton(d, phases, [], ZONE_MARGIN)
      const w0 = worldWithout(m0, pending)
      const ctx0 = hopContext(m0, w0, k)
      const throwPlan = throwAlong(w0, ctx0.origin, t0, v)
      const cr = crossing(ctx0, t0, throwPlan, CATALOG[v.id].orbitRadius!, su.searchFlight * 1.5)
      if (!cr) throw new Error(`hop ${k + 1}: the throw never reaches the orbit of ${v.id}`)
      phases.set(v.id, ((cr.angle + v.offset - meanMotion(v.id) * cr.t) / DEG + 3600) % 360)
      pending.delete(v.id)
      const m1 = skeleton(d, phases, [], ZONE_MARGIN)
      const ctx1 = hopContext(m1, worldWithout(m1, pending), k)
      const cr2 = crossing(ctx1, t0, throwPlan, CATALOG[h.to].orbitRadius!, su.searchFlight * 1.5, cr.t)
      if (!cr2) throw new Error(`hop ${k + 1}: after ${v.id} the ship never reaches the orbit of ${h.to}`)
      phases.set(h.to, ((cr2.angle - meanMotion(h.to) * cr2.t) / DEG + 3600) % 360)
      pending.delete(h.to)
    } else if (pending.has(h.to)) {
      // Hohmann geometry first, then nudge the phase until the cheapest window opens `windowAfter` after parking
      const want = h.windowAfter ?? 1
      pending.delete(h.to)
      const m0 = skeleton(d, phases, [], ZONE_MARGIN)
      const w0 = worldWithout(m0, pending)
      const o = bodyState(w0.system, w0.indexOf(su.origin), t0 + want)
      let phase = Math.atan2(o.y, o.x) + Math.PI - meanMotion(h.to) * (t0 + want + su.hohmann)
      const relative = meanMotion(su.origin) - meanMotion(h.to)
      for (let it = 0; it < 8; it++) {
        phases.set(h.to, ((phase / DEG) % 360 + 360) % 360)
        const m = skeleton(d, phases, [], ZONE_MARGIN)
        const best = porkchop(hopContext(m, worldWithout(m, pending), k), t0, su.maxWait, su.searchFlight)[0]
        if (!best || Math.abs(best.plan.wait - want) < 0.08) break
        phase += (want - best.plan.wait) * relative
      }
    }
    const plan1 = () => {
      const m = skeleton(d, phases, [], ZONE_MARGIN)
      const w = worldWithout(m, pending)
      return planHop(d, m, w, k, t0, h.via ? throwAlong(w, hopContext(m, w, k).origin, t0, h.via) : null)
    }
    let r = plan1()
    if (!r) throw new Error(`hop ${k + 1} (${su.origin} → ${h.to}): no arriving plan (pass 1)`)
    // Lambert ignores the target's pull and the ring: the real cheapest window can sit earlier than it says.
    // If it slid to the very start, move the target so that the window opens later, as designed.
    const auto = d.bodies.find((x) => x.id === h.to)?.phase === 'auto' && !h.via
    const want = h.windowAfter ?? 1
    for (let it = 0; auto && it < 3 && r.plan.wait < want * 0.5; it++) {
      const relative = meanMotion(su.origin) - meanMotion(h.to)
      const shifted = ((phases.get(h.to)! * DEG + (want - r.plan.wait) * relative) / DEG + 360) % 360
      phases.set(h.to, shifted)
      const next = plan1()
      if (!next) break
      r = next
    }
    pass1.push(r.plan)
    t0 = nextStart(t0, r.plan, gameFlight(d, phases, pending, k, t0, r.plan))
  })
  d.bodies.forEach((x, i) => {
    if (pending.has(x.id)) phases.set(x.id, (i * 77) % 360)
  })

  // ── pass 2: every planet in place (the giants pull every hop), each hop planned again in order
  const plans: { plan: Plan; out: Outcome; flight: number }[] = []
  t0 = 0
  const starts: number[] = []
  const none = new Set<BodyId>()
  d.hops.forEach((h, k) => {
    const m = skeleton(d, phases, [], ZONE_MARGIN)
    const r = planHop(d, m, buildWorld(m), k, t0, pass1[k])
    if (!r) throw new Error(`hop ${k + 1} (${setup(d, k).origin} → ${h.to}): no arriving plan with every planet in place`)
    const flight = gameFlight(d, phases, none, k, t0, r.plan)
    plans.push({ ...r, flight })
    starts.push(t0)
    t0 = nextStart(t0, r.plan, flight)
  })

  // ── the belt: rocks along an orbit, with a gap exactly where and when the reference crosses it
  let asteroids: Asteroid[] = []
  if (d.belt) {
    const belt = d.belt
    const m = skeleton(d, phases, [], ZONE_MARGIN)
    const w = buildWorld(m)
    const k = d.hops.findIndex((_, i) => {
      const su = setup(d, i)
      const r1 = CATALOG[su.origin].orbitRadius!
      const r2 = CATALOG[d.hops[i].to].orbitRadius!
      return (r1 - belt.radius) * (r2 - belt.radius) < 0
    })
    const cr = crossing(hopContext(m, w, k), starts[k], plans[k].plan, belt.radius, plans[k].flight)
    if (!cr) throw new Error('the reference never crosses the belt')
    const n = Math.pow(belt.radius, -1.5)
    const gap = 16
    const half = belt.count / 2
    asteroids = Array.from({ length: belt.count }, (_, i) => {
      const sideSign = i < half ? -1 : 1
      const j = i < half ? i : i - half
      const offset = sideSign * (gap / 2 + (j * (belt.spread / 2 - gap / 2)) / Math.max(1, half - 1))
      return {
        orbitRadius: round(belt.radius + (((i * 7) % 5) - 2) * 0.025),
        phaseDeg: round((((cr.angle - n * cr.t) / DEG + offset) % 360 + 360) % 360, 3),
        radius: round(belt.rock * (0.8 + ((i * 3) % 4) * 0.12)),
        sprite: i % 8,
      }
    })
  }

  // ── the mission: measure the reference in the game itself, then size the tank and the stars on what it spent
  const power = Math.max(...plans.map((p) => Math.hypot(p.plan.dvx, p.plan.dvy))) * 1.6
  const mission: Mission = {
    ...skeleton(d, phases, asteroids),
    number,
    bodies: d.bodies.map((x) => ({ id: x.id, phaseDeg: phases.get(x.id)! })),
    power: round(power),
    boostMax: round(power * 0.08),
  }
  mission.hops = d.hops.map((h, k) => {
    const p = plans[k]
    const su = setup(d, k)
    return {
      to: h.to,
      zoneRadius: h.zone,
      maxFlight: round(Math.max(p.flight * 2, su.hohmann * 2) + 2),
      previewTime: round(p.flight * (h.preview ?? 1.15)),
      parkPace: round(Math.min(2.5, Math.max(0.35, p.plan.wait / 5))),
      flightPace: round(p.flight / FLIGHT_SECONDS),
      reference: { wait: p.plan.wait, dvx: p.plan.dvx, dvy: p.plan.dvy },
      refFlight: round(p.flight),
      refCost: 0,
      view: { x: 0, y: 0, radius: 3 },
    }
  })
  const first = playReference(mission)
  if (!first.ok) throw new Error(`the reference fails in the game: ${first.why}`)
  const refCost = first.spent
  mission.refCost = round(refCost)
  mission.fuel = round(refCost * d.fuelFactor)
  mission.stars = starThresholds(refCost, mission.fuel)
  mission.hops.forEach((hop, k) => {
    hop.refCost = round(first.hopCosts[k])
    hop.view = first.views[k]
  })
  if (d.deadlineFactor) mission.deadline = round(first.endT * d.deadlineFactor)
  const second = playReference(mission)
  if (!second.ok || second.stars !== 3) throw new Error(`the sized mission fails: ${second.why || `${second.stars} stars`}`)

  const lines = mission.hops.map(
    (hop, k) =>
      `${setup(d, k).origin}→${hop.to}: wait ${hop.reference.wait.toFixed(2)} (${Math.round(toDays(hop.reference.wait))} d) flight ${hop.refFlight.toFixed(2)} (Hohmann ${setup(d, k).hohmann.toFixed(2)}) cost ${toKms(hop.refCost).toFixed(2)} km/s (launch ${toKms(Math.hypot(hop.reference.dvx, hop.reference.dvy)).toFixed(2)})`,
  )
  const report = `${d.id} ${d.title}: ref ${toKms(refCost).toFixed(2)} km/s, tank ${toKms(mission.fuel).toFixed(2)}, ${Math.round(toDays(first.endT))} d${mission.deadline ? `, deadline ${Math.round(toDays(mission.deadline))} d` : ''}\n  ${lines.join('\n  ')}`
  return { mission, report }
}

/** Flies the reference through the game's Session with a 60 Hz clock, launching exactly on each window. */
export function playReference(mission: Mission): {
  ok: boolean
  why: string
  endT: number
  spent: number
  stars: number
  hopCosts: number[]
  flights: number[]
  views: Hop['view'][]
} {
  const s = new Session(mission)
  const views: Hop['view'][] = []
  const hopCosts: number[] = []
  const flights: number[] = []
  const fail = (why: string) => ({ ok: false, why, endT: s.t, spent: s.totalSpent, stars: 0, hopCosts, flights, views })
  let spentBefore = 0
  let launchedAt = 0
  let guard = 0
  while (s.phase !== 'complete' && guard++ < 400000) {
    const k = s.hopIndex
    const hop = mission.hops[k]
    if (s.phase === 'parked') {
      const launchAt = s.checkpoint.t + hop.reference.wait
      if (s.t + hop.parkPace / 60 < launchAt) {
        s.update(1 / 60)
        continue
      }
      s.t = launchAt
      s.setAim(hop.reference.dvx, hop.reference.dvy)
      spentBefore = s.totalSpent
      launchedAt = s.t
      if (!s.launch()) return fail(`hop ${k + 1}: launch refused (fuel ${toKms(s.fuel).toFixed(2)} km/s)`)
      const f = s.flight!
      let x0 = Infinity
      let y0 = Infinity
      let x1 = -Infinity
      let y1 = -Infinity
      const add = (x: number, y: number) => {
        x0 = Math.min(x0, x)
        y0 = Math.min(y0, y)
        x1 = Math.max(x1, x)
        y1 = Math.max(y1, y)
      }
      const res = f.current.result
      for (let i = 0; i < res.sampleCount; i++) add(res.samples[i * SAMPLE_STRIDE + 1], res.samples[i * SAMPLE_STRIDE + 2])
      const tp = bodyState(s.world.system, s.target, f.end.t)
      add(tp.x, tp.y)
      add(0, 0)
      views.push({ x: round((x0 + x1) / 2), y: round((y0 + y1) / 2), radius: round(Math.max(x1 - x0, y1 - y0) / 2 + 0.35) })
      continue
    }
    if (s.phase === 'failed') return fail(`hop ${k + 1}: ${s.failure?.reason}${s.failure?.need ? ` (short by ${toKms(s.failure.need).toFixed(2)} km/s)` : ''}`)
    const wasFlight = s.phase === 'flight'
    s.update(1 / 60)
    if (wasFlight && s.phase === 'capture') {
      hopCosts.push(s.totalSpent - spentBefore)
      flights.push(s.t - launchedAt)
    }
  }
  if (s.phase !== 'complete') return fail('never completed')
  return { ok: true, why: '', endT: s.t, spent: s.result!.spent, stars: s.result!.stars, hopCosts, flights, views }
}

// ───────────────────────────────────────── main

const isMain = process.argv[1]?.endsWith('mission-build.ts')
const only = process.argv[2]
if (isMain) {
  const built: Mission[] = []
  let failed = false
  DRAFTS.forEach((d, i) => {
    if (only && d.id !== only) return
    try {
      const { mission, report } = build(d, i + 1)
      built.push(mission)
      console.log('ok  ', report)
    } catch (err) {
      failed = true
      console.log('FAIL', d.id, (err as Error).message)
    }
  })
  if (!only && !failed) {
    const body = built
      .map((l) => `  {\n${Object.entries(l).map(([k, v]) => `    ${k}: ${JSON.stringify(v)},`).join('\n')}\n  }`)
      .join(',\n')
    writeFileSync(
      'src/game/casual/levels.ts',
      `// Generated by tools/mission-build.ts — edit the drafts there, then run \`npm run levels\`.
import type { Mission } from './types'

export const MISSIONS: Mission[] = [
${body},
]

export const CHAPTERS = ${JSON.stringify(CHAPTERS, null, 2).replace(/"(\w+)":/g, '$1:')}

const BY_ID = new Map(MISSIONS.map((m) => [m.id, m]))
export const getMission = (id: string): Mission => {
  const m = BY_ID.get(id)
  if (!m) throw new Error(\`Unknown mission \${id}\`)
  return m
}
`,
    )
    console.log(`wrote ${built.length} missions`)
  }
}
