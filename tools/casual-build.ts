/**
 * Builds the casual missions: flies each reference launch through the real propagator, puts the planets where the
 * ship will be, lays the stardust on the route and writes src/game/casual/levels.ts.
 *   npx tsx tools/casual-build.ts [id]      (no id = all)
 */
import { writeFileSync } from 'node:fs'
import { CATALOG, STAR_MU, type BodyId } from '../src/game/levels/catalog'
import { Flight, previewPath } from '../src/game/casual/sim'
import type { Asteroid, CasualLevel } from '../src/game/casual/types'
import { buildWorld, launchFrom } from '../src/game/casual/world'
import { SAMPLE_STRIDE, newSample, sampleTrajectory } from '../src/game/physics/interpolate'
import { propagate, type PropagationResult } from '../src/game/physics/propagate'
import { bodyState } from '../src/game/physics/system'
import { toDays, toKms } from '../src/game/physics/units'
import { slingshotGain } from '../src/game/casual/scoring'

const RAD = 180 / Math.PI
const BOOST_SHARE = 0.12

type Dust = { frac: number } | { periapsis: BodyId; shift?: number }

export interface Draft {
  id: string
  chapter: number
  title: string
  goal: string
  hint: string
  home: BodyId
  bodies: { id: BodyId; phaseDeg: number }[]
  /** launch Δv: magnitude and angle from the home planet's direction of motion (+ = away from the star), degrees */
  launch: { mag: number; angleDeg: number }
  /** planets to put on the path, in order (helpers first, the target last) */
  place: { id: BodyId; dir: 'out' | 'in'; offset: number; afterFlybyOf?: BodyId }[]
  target: { bodyId: BodyId; zoneRadius: number }
  dust: [Dust, Dust, Dust]
  preview: number | 'untilFlyby'
  /** fuel for in-flight boosts, in full charges (0 = launch only) */
  boosts: number
  belt?: { radius: number; perSide: number; gap: number; spacing: number; rock: number }
}

export const DRAFTS: Draft[] = [
  // ── Глава 1: внутренняя система
  {
    id: 'c1',
    chapter: 1,
    title: 'Первый бросок',
    goal: 'Долети до Рубры',
    hint: 'Оттяни корабль назад и отпусти — как из рогатки',
    home: 'aqua',
    bodies: [b('cinder', 70), b('aqua', 205), b('rubra', 0), b('colossus', 120), b('aurum', 300), b('borey', 40)],
    launch: { mag: 0.125, angleDeg: 0 },
    place: [{ id: 'rubra', dir: 'out', offset: 0 }],
    target: { bodyId: 'rubra', zoneRadius: 0.16 },
    dust: [{ frac: 0.3 }, { frac: 0.55 }, { frac: 0.8 }],
    preview: 1,
    boosts: 0,
  },
  {
    id: 'c2',
    chapter: 1,
    title: 'Упреждение',
    goal: 'Поймай Рубру на бегу',
    hint: 'Планеты движутся: целься туда, где Рубра будет',
    home: 'aqua',
    bodies: [b('cinder', 300), b('aqua', 120), b('rubra', 0), b('colossus', 250), b('aurum', 20), b('borey', 200)],
    launch: { mag: 0.17, angleDeg: 35 },
    place: [{ id: 'rubra', dir: 'out', offset: 0 }],
    target: { bodyId: 'rubra', zoneRadius: 0.15 },
    dust: [{ frac: 0.25 }, { frac: 0.5 }, { frac: 0.78 }],
    preview: 0.55,
    boosts: 1,
  },
  {
    id: 'c3',
    chapter: 1,
    title: 'Вниз, к звезде',
    goal: 'Спустись к Пеплу',
    hint: 'Толкни корабль назад, против движения Аквы, — и он упадёт к звезде',
    home: 'aqua',
    bodies: [b('cinder', 0), b('aqua', 330), b('rubra', 150), b('colossus', 40), b('aurum', 210), b('borey', 110)],
    launch: { mag: 0.18, angleDeg: 180 },
    place: [{ id: 'cinder', dir: 'in', offset: 0 }],
    target: { bodyId: 'cinder', zoneRadius: 0.12 },
    dust: [{ frac: 0.3 }, { frac: 0.58 }, { frac: 0.84 }],
    preview: 0.5,
    boosts: 2,
  },
  {
    id: 'c4',
    chapter: 1,
    title: 'Вокруг Лиры',
    goal: 'Обогни звезду и поймай Пепел',
    hint: 'Нырни поближе к Лире — она развернёт корабль. Только не сгори!',
    home: 'aqua',
    bodies: [b('cinder', 0), b('aqua', 60), b('rubra', 250), b('colossus', 160), b('aurum', 330), b('borey', 270)],
    launch: { mag: 0.3, angleDeg: 180 },
    place: [{ id: 'cinder', dir: 'out', offset: 0 }],
    target: { bodyId: 'cinder', zoneRadius: 0.12 },
    dust: [{ frac: 0.35 }, { periapsis: 'lyra' }, { frac: 0.86 }],
    preview: 0.4,
    boosts: 2,
  },
  // ── Глава 2: гиганты
  {
    id: 'c5',
    chapter: 2,
    title: 'Первая праща',
    goal: 'Долети до Аурума через Колосс',
    hint: 'Пролети позади Колосса — его гравитация разгонит корабль',
    home: 'aqua',
    bodies: [b('cinder', 0), b('aqua', 190), b('rubra', 100), b('colossus', 0), b('aurum', 0), b('borey', 230)],
    launch: { mag: 0.215, angleDeg: 0 },
    place: [
      { id: 'colossus', dir: 'out', offset: 0.12 },
      { id: 'aurum', dir: 'out', offset: 0, afterFlybyOf: 'colossus' },
    ],
    target: { bodyId: 'aurum', zoneRadius: 0.28 },
    dust: [{ frac: 0.25 }, { periapsis: 'colossus' }, { frac: 0.82 }],
    preview: 'untilFlyby',
    boosts: 2,
  },
  {
    id: 'c6',
    chapter: 2,
    title: 'Тормоз',
    goal: 'Затормози о Колосс и вернись к Акве',
    hint: 'Пролёт перед планетой, навстречу её движению, отнимает скорость',
    home: 'rubra',
    bodies: [b('cinder', 120), b('aqua', 0), b('rubra', 30), b('colossus', 0), b('aurum', 250), b('borey', 140)],
    launch: { mag: 0.2, angleDeg: 40 },
    place: [
      { id: 'colossus', dir: 'out', offset: -0.16 },
      { id: 'aqua', dir: 'in', offset: 0, afterFlybyOf: 'colossus' },
    ],
    target: { bodyId: 'aqua', zoneRadius: 0.18 },
    dust: [{ frac: 0.22 }, { periapsis: 'colossus' }, { frac: 0.8 }],
    preview: 'untilFlyby',
    boosts: 2,
  },
  {
    id: 'c7',
    chapter: 2,
    title: 'Крутой вираж',
    goal: 'Развернись у Колосса и долети до Борея',
    hint: 'Чем ближе к гиганту, тем круче поворот',
    home: 'aqua',
    bodies: [b('cinder', 200), b('aqua', 250), b('rubra', 30), b('colossus', 0), b('aurum', 100), b('borey', 0)],
    launch: { mag: 0.23, angleDeg: 10 },
    place: [
      { id: 'colossus', dir: 'out', offset: 0.1 },
      { id: 'borey', dir: 'out', offset: 0, afterFlybyOf: 'colossus' },
    ],
    target: { bodyId: 'borey', zoneRadius: 0.3 },
    dust: [{ frac: 0.2 }, { periapsis: 'colossus' }, { frac: 0.75 }],
    preview: 'untilFlyby',
    boosts: 2,
  },
  {
    id: 'c8',
    chapter: 2,
    title: 'Пояс астероидов',
    goal: 'Проскочи пояс и долети до Аурума',
    hint: 'Не задень камни — врезался, значит, заново',
    home: 'aqua',
    bodies: [b('cinder', 50), b('aqua', 100), b('rubra', 300), b('colossus', 0), b('aurum', 0), b('borey', 320)],
    launch: { mag: 0.22, angleDeg: 0 },
    place: [
      { id: 'colossus', dir: 'out', offset: 0.12 },
      { id: 'aurum', dir: 'out', offset: 0, afterFlybyOf: 'colossus' },
    ],
    target: { bodyId: 'aurum', zoneRadius: 0.28 },
    dust: [{ frac: 0.28 }, { periapsis: 'colossus' }, { frac: 0.84 }],
    preview: 'untilFlyby',
    boosts: 2,
    belt: { radius: 3.3, perSide: 6, gap: 0.16, spacing: 0.085, rock: 0.045 },
  },
  // ── Глава 3: окраина
  {
    id: 'c9',
    chapter: 3,
    title: 'Двойная праща',
    goal: 'Колосс, потом Аурум — и до Борея',
    hint: 'Два разгона подряд: каждая праща добавляет скорость',
    home: 'aqua',
    bodies: [b('cinder', 0), b('aqua', 200), b('rubra', 60), b('colossus', 0), b('aurum', 0), b('borey', 0), b('viola', 200)],
    launch: { mag: 0.235, angleDeg: 0 },
    place: [
      { id: 'colossus', dir: 'out', offset: 0.11 },
      { id: 'aurum', dir: 'out', offset: 0.06, afterFlybyOf: 'colossus' },
      { id: 'borey', dir: 'out', offset: 0, afterFlybyOf: 'aurum' },
    ],
    target: { bodyId: 'borey', zoneRadius: 0.3 },
    dust: [{ periapsis: 'colossus' }, { periapsis: 'aurum' }, { frac: 0.9 }],
    preview: 'untilFlyby',
    boosts: 2,
  },
  {
    id: 'c10',
    chapter: 3,
    title: 'Сквозь кольца',
    goal: 'Пронесись у самого Аурума к Виоле',
    hint: 'Кольца Аурума не опасны — опасна сама планета',
    home: 'aqua',
    bodies: [b('cinder', 100), b('aqua', 330), b('rubra', 200), b('colossus', 0), b('aurum', 0), b('borey', 60), b('viola', 0)],
    launch: { mag: 0.23, angleDeg: 0 },
    place: [
      { id: 'colossus', dir: 'out', offset: 0.1 },
      { id: 'aurum', dir: 'out', offset: 0.035, afterFlybyOf: 'colossus' },
      { id: 'viola', dir: 'out', offset: 0, afterFlybyOf: 'aurum' },
    ],
    target: { bodyId: 'viola', zoneRadius: 0.3 },
    dust: [{ frac: 0.2 }, { periapsis: 'aurum' }, { frac: 0.88 }],
    preview: 'untilFlyby',
    boosts: 2,
  },
  {
    id: 'c11',
    chapter: 3,
    title: 'Бумеранг',
    goal: 'Слетай к Ауруму и вернись к Рубре',
    hint: 'Пролёт перед Аурумом развернёт корабль обратно, к звезде',
    home: 'aqua',
    bodies: [b('cinder', 30), b('aqua', 160), b('rubra', 0), b('colossus', 250), b('aurum', 0), b('borey', 60), b('viola', 120)],
    launch: { mag: 0.3, angleDeg: 30 },
    place: [
      { id: 'aurum', dir: 'out', offset: -0.06 },
      { id: 'rubra', dir: 'in', offset: 0, afterFlybyOf: 'aurum' },
    ],
    target: { bodyId: 'rubra', zoneRadius: 0.2 },
    dust: [{ frac: 0.25 }, { periapsis: 'aurum' }, { frac: 0.85 }],
    preview: 'untilFlyby',
    boosts: 3,
  },
  {
    id: 'c12',
    chapter: 3,
    title: 'Гранд-тур',
    goal: 'Колосс, Аурум, Борей — и к Виоле',
    hint: 'Три пращи подряд. Это и есть настоящий слингшот!',
    home: 'aqua',
    bodies: [b('cinder', 0), b('aqua', 210), b('rubra', 300), b('colossus', 0), b('aurum', 0), b('borey', 0), b('viola', 0)],
    launch: { mag: 0.245, angleDeg: 0 },
    place: [
      { id: 'colossus', dir: 'out', offset: 0.1 },
      { id: 'aurum', dir: 'out', offset: 0.055, afterFlybyOf: 'colossus' },
      { id: 'borey', dir: 'out', offset: 0.05, afterFlybyOf: 'aurum' },
      { id: 'viola', dir: 'out', offset: 0, afterFlybyOf: 'borey' },
    ],
    target: { bodyId: 'viola', zoneRadius: 0.3 },
    dust: [{ periapsis: 'colossus' }, { periapsis: 'aurum' }, { periapsis: 'borey' }],
    preview: 'untilFlyby',
    boosts: 3,
  },
]

function b(id: BodyId, phaseDeg: number) {
  return { id, phaseDeg }
}

function asLevel(d: Draft, number: number): CasualLevel {
  return {
    id: d.id,
    chapter: d.chapter,
    number,
    title: d.title,
    goal: d.goal,
    hint: d.hint,
    bodies: d.bodies.map((x) => ({ ...x })),
    home: d.home,
    target: { ...d.target },
    stardust: [],
    asteroids: [],
    power: 1,
    fuel: 0,
    boostMax: 0.03,
    previewTime: 1,
    refTime: 1,
    horizon: 40,
    pace: 1,
    reference: { dvx: 0, dvy: 0 },
    view: { x: 0, y: 0, radius: 3 },
  }
}

function launchVector(level: CasualLevel, mag: number, angleDeg: number) {
  const world = buildWorld(level)
  const home = bodyState(world.system, world.homeIndex, 0)
  const v = Math.hypot(home.vx, home.vy)
  const px = home.vx / v
  const py = home.vy / v
  const a = angleDeg / RAD
  // radial-out = direction of motion rotated 90° clockwise
  return { dvx: mag * (Math.cos(a) * px + Math.sin(a) * py), dvy: mag * (Math.cos(a) * py - Math.sin(a) * px) }
}

function fly(level: CasualLevel, dv: { dvx: number; dvy: number }, withTarget: boolean, absent: BodyId[] = []): PropagationResult {
  const world = buildWorld(level)
  // bodies not placed yet do not exist for this flight
  const bodies = world.system.bodies.map((body, i) =>
    absent.includes(world.planetOf[i] as BodyId) ? { ...body, mu: 0, radius: 1e-9, influenceRadius: 0 } : body,
  )
  return propagate({
    system: { ...world.system, bodies },
    t0: 0,
    state0: launchFrom(world, dv.dvx, dv.dvy),
    burns: [],
    tEnd: level.horizon,
    target: withTarget ? { bodyIndex: world.targetIndex, zoneRadius: level.target.zoneRadius, maxRelSpeed: null } : null,
    escapeRadius: 9.5,
    departureBodyIndex: world.homeIndex,
    maxStep: 0.03,
  })
}

function crossing(r: PropagationResult, radius: number, dir: 'out' | 'in', after: number) {
  const s = r.samples
  for (let i = 1; i < r.sampleCount; i++) {
    const o0 = (i - 1) * SAMPLE_STRIDE
    const o1 = i * SAMPLE_STRIDE
    if (s[o1] < after) continue
    const r0 = Math.hypot(s[o0 + 1], s[o0 + 2])
    const r1 = Math.hypot(s[o1 + 1], s[o1 + 2])
    if (dir === 'out' ? r0 < radius && r1 >= radius : r0 > radius && r1 <= radius) {
      const k = (radius - r0) / (r1 - r0)
      const x = s[o0 + 1] + k * (s[o1 + 1] - s[o0 + 1])
      const y = s[o0 + 2] + k * (s[o1 + 2] - s[o0 + 2])
      return { t: s[o0] + k * (s[o1] - s[o0]), angle: Math.atan2(y, x) }
    }
  }
  return null
}

const meanMotion = (a: number) => Math.sqrt(STAR_MU / a ** 3)
const phaseFor = (a: number, angle: number, t: number) => ((((angle - meanMotion(a) * t) * RAD) % 360) + 360) % 360

function setPhase(level: CasualLevel, id: BodyId, phaseDeg: number) {
  const entry = level.bodies.find((x) => x.id === id)
  if (!entry) throw new Error(`${level.id}: ${id} is not in the level`)
  entry.phaseDeg = phaseDeg
}

export function build(d: Draft, number: number): { level: CasualLevel; report: string } {
  const level = asLevel(d, number)
  const dv = launchVector(level, d.launch.mag, d.launch.angleDeg)
  level.reference = dv

  const pending = d.place.map((p) => p.id)
  for (const step of d.place) {
    // fly without the bodies still to be placed, then put this one where the ship crosses its orbit
    const a = CATALOG[step.id].orbitRadius!
    const r = fly(level, dv, false, pending)
    pending.shift()
    let after = 0
    if (step.afterFlybyOf) {
      const world = buildWorld(level)
      const idx = world.planetOf.indexOf(step.afterFlybyOf)
      const fb = r.flybys.find((f) => f.bodyIndex === idx)
      if (!fb) throw new Error(`${d.id}: no flyby of ${step.afterFlybyOf} before placing ${step.id}`)
      after = fb.tOut
    }
    const c = crossing(r, a, step.dir, after)
    if (!c) {
      let maxR = 0
      let minR = Infinity
      for (let i = 0; i < r.sampleCount; i++) {
        if (r.samples[i * SAMPLE_STRIDE] < after) continue
        const rr = Math.hypot(r.samples[i * SAMPLE_STRIDE + 1], r.samples[i * SAMPLE_STRIDE + 2])
        maxR = Math.max(maxR, rr)
        minR = Math.min(minR, rr)
      }
      const gains = r.flybys.map((f) => `${buildWorld(level).planetOf[f.bodyIndex]}:${slingshotGain(f).toFixed(1)}@${f.distance.toFixed(3)}`).join(' ')
      throw new Error(`${d.id}: the ship never crosses the orbit of ${step.id} (${step.dir}); r after: ${minR.toFixed(2)}..${maxR.toFixed(2)}, end ${r.endReason}, flybys ${gains}`)
    }
    setPhase(level, step.id, phaseFor(a, c.angle + step.offset, c.t))
  }

  const ref = fly(level, dv, true)
  if (ref.endReason !== 'arrived') throw new Error(`${d.id}: reference does not arrive (${ref.endReason})`)
  const T = ref.arrival!.t
  const world = buildWorld(level)
  const tmp = newSample()

  // stardust on the route
  level.stardust = d.dust.map((dust) => {
    let t: number
    if ('frac' in dust) t = dust.frac * T
    else if (dust.periapsis === 'lyra') {
      // closest point to the star
      let best = 0
      let bestR = Infinity
      for (let i = 0; i < ref.sampleCount; i++) {
        const rr = Math.hypot(ref.samples[i * SAMPLE_STRIDE + 1], ref.samples[i * SAMPLE_STRIDE + 2])
        if (rr < bestR) {
          bestR = rr
          best = ref.samples[i * SAMPLE_STRIDE]
        }
      }
      t = best + (dust.shift ?? 0)
    } else {
      const idx = world.planetOf.indexOf(dust.periapsis)
      const fb = ref.flybys.find((f) => f.bodyIndex === idx)
      if (!fb) throw new Error(`${d.id}: no flyby of ${dust.periapsis} for stardust`)
      t = fb.t + (dust.shift ?? 0)
    }
    const s = sampleTrajectory(ref.samples, ref.sampleCount, t, tmp)
    return [round(s.x), round(s.y)] as [number, number]
  })

  // asteroid belt with a gap where the reference crosses it
  if (d.belt) {
    const c = crossing(ref, d.belt.radius, 'out', 0)
    if (!c) throw new Error(`${d.id}: reference does not cross the belt`)
    const rocks: Asteroid[] = []
    for (let side = -1; side <= 1; side += 2) {
      for (let j = 0; j < d.belt.perSide; j++) {
        const angle = c.angle + side * (d.belt.gap / 2 + j * d.belt.spacing)
        rocks.push({
          orbitRadius: round(d.belt.radius + (((j * 7 + (side > 0 ? 3 : 0)) % 5) - 2) * 0.03),
          phaseDeg: round(phaseFor(d.belt.radius, angle, c.t), 4),
          radius: d.belt.rock,
          sprite: (j + (side > 0 ? 4 : 0)) % 8,
        })
      }
    }
    level.asteroids = rocks
  }

  // tuning derived from the reference
  const mag = Math.hypot(dv.dvx, dv.dvy)
  level.power = round(mag * 1.55)
  // one full charge corrects a launch aimed ~7° off; the tank holds `boosts` of them
  level.boostMax = round(mag * BOOST_SHARE)
  level.fuel = round(mag * BOOST_SHARE * d.boosts)
  level.horizon = round(T * 2.2 + 2)
  level.pace = round(T / 7.5)
  level.refTime = round(T)
  const firstFlyby = ref.flybys.find((f) => world.planetOf[f.bodyIndex] !== d.target.bodyId)
  level.previewTime = round(d.preview === 'untilFlyby' ? (firstFlyby ? firstFlyby.tIn * 0.92 : T * 0.4) : d.preview * T)

  // view: the reference route, the start and the target at arrival
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
  for (let i = 0; i < ref.sampleCount; i++) add(ref.samples[i * SAMPLE_STRIDE + 1], ref.samples[i * SAMPLE_STRIDE + 2])
  const tgt = bodyState(world.system, world.targetIndex, 0)
  add(tgt.x, tgt.y)
  level.view = { x: round((x0 + x1) / 2), y: round((y0 + y1) / 2), radius: round(Math.max(x1 - x0, y1 - y0) / 2 + 0.45) }

  // verify with the game's own flight model
  const flight = new Flight(level, dv).runToEnd()
  const got = flight.collected.filter(Boolean).length
  const preview = previewPath(level, world, dv.dvx, dv.dvy, level.previewTime)
  const gains = flight.flybys().map((f) => `${world.planetOf[f.bodyIndex]}:${slingshotGain(f).toFixed(1)}`).join(' ')
  const report = `${d.id} ${d.title}: ${flight.end.reason} t=${T.toFixed(2)} (${Math.round(toDays(T))} d) dust ${got}/3 launch ${toKms(mag).toFixed(2)} km/s preview ${level.previewTime} (${preview.endReason}) flybys ${gains}`
  if (flight.end.reason !== 'arrived' || got !== 3) throw new Error(`${report}\n  -> reference does not win with 3 stars`)
  return { level, report }
}

function round(v: number, digits = 5): number {
  const k = 10 ** digits
  return Math.round(v * k) / k
}

const isMain = process.argv[1]?.endsWith('casual-build.ts')
const only = process.argv[2]
const built: CasualLevel[] = []
let failed = !isMain
if (isMain) DRAFTS.forEach((d, i) => {
  if (only && d.id !== only) return
  try {
    const { level, report } = build(d, i + 1)
    built.push(level)
    console.log('ok  ', report)
  } catch (err) {
    failed = true
    console.log('FAIL', d.id, (err as Error).message)
  }
})

if (isMain && !only && !failed) {
  // one key per line, values compact: small diffs when a level is retuned
  const body = built
    .map((l) => `  {\n${Object.entries(l).map(([k, v]) => `    ${k}: ${JSON.stringify(v)},`).join('\n')}\n  }`)
    .join(',\n')
  writeFileSync(
    'src/game/casual/levels.ts',
    `// Generated by tools/casual-build.ts — edit the drafts there, then run \`npx tsx tools/casual-build.ts\`.
import type { CasualLevel } from './types'

export const CASUAL_LEVELS: CasualLevel[] = [
${body},
]

export const CHAPTERS = [
  { number: 1, title: 'Внутренняя система', starsToOpen: 0 },
  { number: 2, title: 'Гиганты', starsToOpen: 6 },
  { number: 3, title: 'Окраина', starsToOpen: 14 },
]

const BY_ID = new Map(CASUAL_LEVELS.map((l) => [l.id, l]))
export const getCasualLevel = (id: string): CasualLevel => {
  const l = BY_ID.get(id)
  if (!l) throw new Error(\`Unknown level \${id}\`)
  return l
}
`,
  )
  console.log(`wrote ${built.length} levels`)
}
