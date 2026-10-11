/**
 * How forgiving each mission is. Perturbs the reference throw by angle (columns, degrees) and power (rows) and
 * prints the stardust collected on arrival, or c/l/t for crashed / lost / timed out.
 * With --boost, a miss is retried with one boost (16 directions × 3 charges, fired at 35 % or 70 % of the preview):
 * "b3" = a boost rescues it with all three stardust, "." = nothing helps. Also times the propagation.
 *   npx tsx tools/casual-sensitivity.ts [id] [--boost]
 */
import { CASUAL_LEVELS } from '../src/game/casual/levels'
import { Flight, previewPath } from '../src/game/casual/sim'
import type { CasualLevel } from '../src/game/casual/types'
import { buildWorld, type CasualWorld } from '../src/game/casual/world'

const args = process.argv.slice(2)
const withBoost = args.includes('--boost')
const only = args.find((a) => !a.startsWith('--'))

function rescue(level: CasualLevel, world: CasualWorld, launch: { dvx: number; dvy: number }): string {
  if (level.fuel <= 0) return '.'
  let best = -1
  for (const share of [0.35, 0.7]) {
    for (let d = 0; d < 16 && best < 3; d++) {
      for (const charge of [0.25, 0.5, 1]) {
        const f = new Flight(level, launch, world)
        const a = (d / 16) * 2 * Math.PI
        if (!f.boost(level.previewTime * share, Math.cos(a), Math.sin(a), charge)) continue
        f.runToEnd()
        if (f.end.reason === 'arrived') best = Math.max(best, f.collected.filter(Boolean).length)
      }
    }
  }
  return best < 0 ? '.' : `b${best}`
}

for (const level of CASUAL_LEVELS) {
  if (only && level.id !== only) continue
  const world = buildWorld(level)
  const { dvx, dvy } = level.reference
  const mag = Math.hypot(dvx, dvy)
  const ang = Math.atan2(dvy, dvx)
  let t0 = performance.now()
  for (let i = 0; i < 20; i++) previewPath(level, world, dvx, dvy, level.previewTime)
  const tPrev = (performance.now() - t0) / 20
  t0 = performance.now()
  for (let i = 0; i < 5; i++) new Flight(level, level.reference, world)
  const tFlight = (performance.now() - t0) / 5
  const cell = (dA: number, k: number) => {
    const a = ang + (dA * Math.PI) / 180
    const launch = { dvx: Math.cos(a) * mag * k, dvy: Math.sin(a) * mag * k }
    const f = new Flight(level, launch, world).runToEnd()
    if (f.end.reason === 'arrived') return String(f.collected.filter(Boolean).length)
    return withBoost ? rescue(level, world, launch) : f.end.reason[0]
  }
  const angles = [-4, -2, -1, -0.5, 0, 0.5, 1, 2, 4]
  console.log(`${level.id} ${level.title}  pull ${((mag / level.power) * 100).toFixed(0)}%  preview ${tPrev.toFixed(1)}ms flight ${tFlight.toFixed(1)}ms`)
  console.log('   k\\dA ' + angles.map((a) => String(a).padStart(5)).join(''))
  for (const k of [0.94, 0.97, 0.99, 1, 1.01, 1.03, 1.06]) {
    console.log('   ' + k.toFixed(2) + ' ' + angles.map((a) => cell(a, k).padStart(5)).join(''))
  }
}
