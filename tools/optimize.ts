/**
 * Finds cheap solutions for designed levels (budget / star calibration, "is the direct route really impossible?").
 *   npx tsx tools/optimize.ts L3 [burns=1|2] [seed]
 */
import type { LevelDef } from '../src/game/levels/types'
import { toDays, toKms } from '../src/game/physics/units'
import type { Plan } from '../src/game/rules/plan'
import { getLevel } from '../src/game/levels/levels'
import { differentialEvolution, fmt, simulate } from './lib'

function decode(level: LevelDef, x: number[], burns: number): Plan {
  const [lt, mag, ang] = x
  const plan: Plan = {
    launchTime: level.start.launchWindow[0] + lt * (level.start.launchWindow[1] - level.start.launchWindow[0]),
    launch: { prograde: mag * Math.cos(ang), radial: mag * Math.sin(ang) },
    nodes: [],
  }
  if (burns >= 2) {
    const [, , , dt, m2, a2] = x
    plan.nodes.push({ id: 'n1', dt, prograde: m2 * Math.cos(a2), radial: m2 * Math.sin(a2) })
  }
  return plan
}

export function missCost(level: LevelDef, plan: Plan, opts: { ignoreBudget?: boolean; noFlybyOf?: number } = {}): number {
  const { result, outcome } = simulate(opts.ignoreBudget ? { ...level, budget: 10 } : level, plan)
  const spent = outcome.plannedDv
  const over = opts.ignoreBudget ? 0 : Math.max(0, spent - level.budget)
  if (opts.noFlybyOf !== undefined && result.flybys.some((f) => f.bodyIndex === opts.noFlybyOf)) return 50 + spent
  if (outcome.success) return spent + over * 10
  const miss = outcome.closestToTarget ? Math.max(0, outcome.closestToTarget.distance - level.target.zoneRadius) : 5
  const late =
    outcome.failure === 'deadline' && level.maxFlightTime ? (outcome.flightTime - level.maxFlightTime) * 0.05 : 0
  return 1 + miss + late + spent * 0.2 + over * 10 + (outcome.failure === 'collision' ? 0.5 : 0)
}

export async function optimize(
  id: string,
  burns: number,
  seed: number,
  ignoreBudget = false,
  noFlybyOf?: number,
  threeStar = false,
) {
  const base = getLevel(id)
  const plan = base.solution
  // "three" mode: the star time limit becomes the deadline, so the cheapest result is a 3-star candidate
  const level = threeStar
    ? { ...base, maxFlightTime: base.stars.timeForThree, horizon: base.stars.timeForThree + 0.2 }
    : base
  const maxMag = level.budget * 1.5
  const bounds: [number, number][] = [
    [0, 1],
    [0, maxMag],
    [-Math.PI, Math.PI],
  ]
  if (burns >= 2) bounds.push([0.2, level.horizon * 0.8], [0, maxMag * 0.5], [-Math.PI, Math.PI])
  const ref = plan.launch
  const seedVec = [
    (plan.launchTime - level.start.launchWindow[0]) / Math.max(1e-9, level.start.launchWindow[1] - level.start.launchWindow[0]),
    Math.hypot(ref.prograde, ref.radial),
    Math.atan2(ref.radial, ref.prograde),
  ]
  const best = differentialEvolution({
    bounds,
    cost: (x) => missCost(level, decode(level, x, burns), { ignoreBudget, noFlybyOf }),
    population: burns >= 2 ? 50 : 30,
    generations: burns >= 2 ? 160 : 100,
    seed,
    seeds: burns >= 2 ? [] : [seedVec],
    log: true,
  })
  const bestPlan = decode(level, best.x, burns)
  const { result, outcome } = simulate(ignoreBudget ? { ...level, budget: 10 } : level, bestPlan)
  console.log(`${id} burns=${burns} cost=${fmt(best.cost)} success=${outcome.success} failure=${outcome.failure}`)
  console.log(
    `  spent=${fmt(outcome.spentDv)} (${fmt(toKms(outcome.spentDv), 2)} km/s) flight=${fmt(outcome.flightTime)} (${Math.round(toDays(outcome.flightTime))} d)`,
  )
  console.log('  plan', JSON.stringify(bestPlan))
  console.log('  flybys', result.flybys.map((f) => `${f.bodyIndex}@${fmt(f.t)} d=${fmt(f.distance)}`).join(', '))
  return { plan: bestPlan, outcome }
}

if (process.argv[1]?.endsWith('optimize.ts')) {
  const noFly = process.argv[6] !== undefined && process.argv[6] !== '-' ? Number(process.argv[6]) : undefined
  await optimize(
    process.argv[2] ?? 'L1',
    Number(process.argv[3] ?? 1),
    Number(process.argv[4] ?? 1),
    process.argv[5] === 'free',
    noFly,
    process.argv[7] === 'three',
  )
}
