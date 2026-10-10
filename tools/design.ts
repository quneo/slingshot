/**
 * Level constructor. For every level it flies a reference plan through the real propagator and places the
 * participating planets where the ship will actually be, then prints phases and the verified plan.
 *   npx tsx tools/design.ts [L1|L2|...]
 */
import { CATALOG, type BodyId } from '../src/game/levels/catalog'
import type { LevelDef } from '../src/game/levels/types'
import { toDays, toKms } from '../src/game/physics/units'
import type { Plan } from '../src/game/rules/plan'
import { fmt, phaseFor, radiusCrossing, setPhase, simulate } from './lib'

type Draft = LevelDef

function report(level: Draft, plan: Plan) {
  const { result, outcome } = simulate(level, plan)
  console.log(`  end=${result.endReason} t=${fmt(result.endTime)} steps=${result.steps} samples=${result.sampleCount}`)
  console.log(
    `  success=${outcome.success} failure=${outcome.failure} spent=${fmt(outcome.spentDv)} (${fmt(toKms(outcome.spentDv), 2)} km/s)` +
      ` flight=${fmt(outcome.flightTime)} (${Math.round(toDays(outcome.flightTime))} d) closest=${fmt(outcome.closestToTarget?.distance ?? NaN)}`,
  )
  for (const f of result.flybys)
    console.log(
      `  flyby ${level.bodies[f.bodyIndex - 1]?.id ?? f.bodyIndex} t=${fmt(f.t)} d=${fmt(f.distance)} vIn=${fmt(f.speedIn)} vOut=${fmt(f.speedOut)}`,
    )
  console.log('  phases:', level.bodies.map((b) => `${b.id}:${fmt(b.phaseDeg, 7)}`).join(' '))
  return { result, outcome }
}

/** Places `id` so it sits at the ship's crossing of its orbit radius (plus an angular offset, rad). */
function placeOnPath(level: Draft, plan: Plan, id: BodyId, dir: 'out' | 'in', offset: number, after = -Infinity): Draft {
  // fly without the body (parked on the far side) and without the arrival stop, then put the body on the path
  const away = setPhase(level, id, (level.bodies.find((x) => x.id === id)!.phaseDeg + 180) % 360)
  const { result } = simulate(away, plan, { noTarget: true })
  const c = radiusCrossing(result, CATALOG[id].orbitRadius!, dir, after)
  if (!c) throw new Error(`ship never crosses orbit of ${id} (${dir})`)
  return setPhase(level, id, phaseFor(id, c.angle + offset, c.t))
}

export async function designedLevels(only?: string): Promise<{ level: LevelDef; plan: Plan }[]> {
  const { DRAFTS } = await import('./drafts')
  return DRAFTS.filter((d) => !only || d.level.id === only).map((draft) => {
    let level = draft.level
    for (const step of draft.placements) level = placeOnPath(level, draft.plan, step.id, step.dir, step.offset, step.after)
    return { level: { ...level, solution: draft.plan }, plan: draft.plan }
  })
}

export async function run(only?: string) {
  for (const { level, plan } of await designedLevels(only)) {
    console.log(`\n=== ${level.id} ${level.title}`)
    report(level, plan)
  }
}

if (process.argv[1]?.endsWith('design.ts')) await run(process.argv[2])
