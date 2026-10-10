import { getLevel } from '../levels/levels'
import { buildMissionSystem, buildPropagationInput } from '../levels/mission'
import { propagate } from '../physics/propagate'
import { evaluateMission } from '../rules/evaluate'
import { planKey, type Plan } from '../rules/plan'
import type { PredictResponse } from './protocol'

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
    computeMs: performance.now() - started,
  }
}
