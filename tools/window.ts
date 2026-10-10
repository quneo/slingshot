/** Scans the launch window: cheapest single-burn Δv for each launch time.  npx tsx tools/window.ts L2 [step] */
import { toDays, toKms } from '../src/game/physics/units'
import { getLevel } from '../src/game/levels/levels'
import { differentialEvolution, fmt } from './lib'
import { missCost } from './optimize'

const id = process.argv[2] ?? 'L2'
const step = Number(process.argv[3] ?? 0.5)
const level = getLevel(id)
const [w0, w1] = level.start.launchWindow
for (let t = w0; t <= w1 + 1e-9; t += step) {
  const best = differentialEvolution({
    bounds: [[0, level.budget * 1.3], [-Math.PI, Math.PI]],
    cost: ([m, a]) => missCost({ ...level, budget: 10 }, { launchTime: t, launch: { prograde: m * Math.cos(a), radial: m * Math.sin(a) }, nodes: [] }),
    population: 16,
    generations: 40,
    seed: 3,
  })
  const ok = best.cost < 1
  console.log(`t=${fmt(t, 2)} (${Math.round(toDays(t))} d): ${ok ? `${fmt(best.cost)} = ${fmt(toKms(best.cost), 2)} km/s${best.cost <= level.budget ? '  ✓ budget' : ''}` : 'no solution'}`)
}
