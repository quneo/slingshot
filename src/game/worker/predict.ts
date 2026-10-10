import { getLevel } from '../levels/levels'
import { buildMissionSystem, buildPropagationInput, type MissionSystem } from '../levels/mission'
import type { LevelDef } from '../levels/types'
import { propagate, type PropagationResult } from '../physics/propagate'
import { evaluateMission } from '../rules/evaluate'
import { planKey, type Plan } from '../rules/plan'
import type { NoAssistPath, PredictResponse } from './protocol'

/**
 * The same flight with the strongest gravity-assist planet made massless: drawn next to the real forecast it
 * shows, at a glance, what the planet's pull did to the path.
 */
function withoutAssist(level: LevelDef, mission: MissionSystem, plan: Plan, result: PropagationResult): NoAssistPath | null {
  const targetIndex = mission.indexOf(level.target.bodyId)
  let body = -1
  let strongest = 0
  let tFrom = 0
  for (const f of result.flybys) {
    if (f.bodyIndex === targetIndex) continue
    const gain = Math.abs(f.energyOut - f.energyIn - f.burnEnergy)
    if (gain > strongest) {
      strongest = gain
      body = f.bodyIndex
      tFrom = f.tIn
    }
  }
  if (body < 0) return null
  const input = buildPropagationInput(level, mission, plan)
  const bodies = input.system.bodies.map((b, i) => (i === body ? { ...b, mu: 0, radius: 1e-9, influenceRadius: 0 } : b))
  const alt = propagate({ ...input, system: { ...input.system, bodies }, target: null, maxSamples: 60_000 })
  return { bodyIndex: body, tFrom, samples: alt.samples, sampleCount: alt.sampleCount }
}

/** The single prediction pipeline, shared by the worker, the synchronous fallback and the tests. */
export function predict(requestId: number, levelId: string, plan: Plan): PredictResponse {
  const started = performance.now()
  const level = getLevel(levelId)
  const mission = buildMissionSystem(level)
  const result = propagate(buildPropagationInput(level, mission, plan))
  const outcome = evaluateMission(level, mission, plan, result)
  return {
    type: 'predicted',
    requestId,
    levelId,
    planKey: planKey(plan),
    result,
    outcome,
    noAssist: withoutAssist(level, mission, plan, result),
    computeMs: performance.now() - started,
  }
}
