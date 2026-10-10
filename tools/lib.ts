/** Shared helpers for level design tools (run with `npx tsx tools/<script>.ts`). */
import { CATALOG, STAR_MU, type BodyId } from '../src/game/levels/catalog'
import { buildMissionSystem, buildPropagationInput } from '../src/game/levels/mission'
import type { LevelDef } from '../src/game/levels/types'
import { SAMPLE_STRIDE } from '../src/game/physics/interpolate'
import { propagate, type PropagationResult } from '../src/game/physics/propagate'
import { evaluateMission, type MissionOutcome } from '../src/game/rules/evaluate'
import type { Plan } from '../src/game/rules/plan'

export const RAD = 180 / Math.PI

export function simulate(
  level: LevelDef,
  plan: Plan,
  opts: { noTarget?: boolean } = {},
): { result: PropagationResult; outcome: MissionOutcome } {
  const mission = buildMissionSystem(level)
  const input = buildPropagationInput(level, mission, plan)
  if (opts.noTarget) input.target = null
  const result = propagate(input)
  return { result, outcome: evaluateMission(level, mission, plan, result) }
}

/** First time after `after` the ship crosses heliocentric radius r in the given direction. */
export function radiusCrossing(
  res: PropagationResult,
  r: number,
  direction: 'out' | 'in',
  after = -Infinity,
): { t: number; angle: number } | null {
  const s = res.samples
  for (let i = 1; i < res.sampleCount; i++) {
    const o0 = (i - 1) * SAMPLE_STRIDE
    const o1 = i * SAMPLE_STRIDE
    if (s[o1] < after) continue
    const r0 = Math.hypot(s[o0 + 1], s[o0 + 2])
    const r1 = Math.hypot(s[o1 + 1], s[o1 + 2])
    const crosses = direction === 'out' ? r0 < r && r1 >= r : r0 > r && r1 <= r
    if (!crosses) continue
    const k = (r - r0) / (r1 - r0)
    const x = s[o0 + 1] + k * (s[o1 + 1] - s[o0 + 1])
    const y = s[o0 + 2] + k * (s[o1 + 2] - s[o0 + 2])
    return { t: s[o0] + k * (s[o1] - s[o0]), angle: Math.atan2(y, x) }
  }
  return null
}

/** Phase (deg at t = 0) that puts a planet at `angle` (rad) at time t. */
export function phaseFor(id: BodyId, angle: number, t: number): number {
  const a = CATALOG[id].orbitRadius!
  const n = Math.sqrt(STAR_MU / a ** 3)
  const deg = ((angle - n * t) * RAD) % 360
  return (deg + 360) % 360
}

export function setPhase(level: LevelDef, id: BodyId, phaseDeg: number): LevelDef {
  return { ...level, bodies: level.bodies.map((b) => (b.id === id ? { ...b, phaseDeg } : b)) }
}

/** Seeded PRNG so tool runs are reproducible. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface DEOptions {
  bounds: [number, number][]
  cost: (x: number[]) => number
  population?: number
  generations?: number
  seed?: number
  seeds?: number[][]
  log?: boolean
}

/** Differential evolution (rand/1/bin). Returns the best vector and its cost. */
export function differentialEvolution(opts: DEOptions): { x: number[]; cost: number } {
  const { bounds, cost } = opts
  const dim = bounds.length
  const np = opts.population ?? Math.max(20, dim * 10)
  const gens = opts.generations ?? 150
  const rnd = mulberry32(opts.seed ?? 1)
  const clamp = (v: number, i: number) => Math.min(bounds[i][1], Math.max(bounds[i][0], v))
  const pop: number[][] = []
  for (let i = 0; i < np; i++) {
    if (opts.seeds && i < opts.seeds.length) pop.push(opts.seeds[i].map(clamp))
    else pop.push(bounds.map(([lo, hi]) => lo + rnd() * (hi - lo)))
  }
  const fit = pop.map(cost)
  for (let g = 0; g < gens; g++) {
    for (let i = 0; i < np; i++) {
      let a: number, b: number, c: number
      do a = Math.floor(rnd() * np); while (a === i)
      do b = Math.floor(rnd() * np); while (b === i || b === a)
      do c = Math.floor(rnd() * np); while (c === i || c === a || c === b)
      const F = 0.5 + 0.3 * rnd()
      const jr = Math.floor(rnd() * dim)
      const trial = pop[i].map((v, j) =>
        j === jr || rnd() < 0.9 ? clamp(pop[a][j] + F * (pop[b][j] - pop[c][j]), j) : v,
      )
      const ft = cost(trial)
      if (ft <= fit[i]) {
        pop[i] = trial
        fit[i] = ft
      }
    }
    if (opts.log && g % 25 === 0) console.log(`  gen ${g}: best ${Math.min(...fit).toFixed(5)}`)
  }
  let best = 0
  for (let i = 1; i < np; i++) if (fit[i] < fit[best]) best = i
  return { x: pop[best], cost: fit[best] }
}

export const fmt = (v: number, d = 4) => Number(v.toFixed(d))
