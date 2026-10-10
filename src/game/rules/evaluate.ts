import type { BodyId } from '../levels/catalog'
import type { MissionSystem } from '../levels/mission'
import type { LevelDef } from '../levels/types'
import type { ApproachPoint, PropagationResult } from '../physics/propagate'
import { analyzeMiss, type MissReport } from './miss'
import { burnCount, impulseMagnitude, plannedDv, sortedNodes, type Plan } from './plan'

const EPS = 1e-9

export type ViolationKind = 'over-budget' | 'too-many-burns' | 'launch-window' | 'node-time'

export interface PlanViolation {
  kind: ViolationKind
  nodeId?: string
}

/** Rule checks that do not need a simulation. The UI shows them, and evaluateMission refuses to succeed with them. */
export function checkPlan(level: LevelDef, plan: Plan): PlanViolation[] {
  const out: PlanViolation[] = []
  if (plannedDv(plan) > level.budget + EPS) out.push({ kind: 'over-budget' })
  if (burnCount(plan) > level.maxBurns) out.push({ kind: 'too-many-burns' })
  const [w0, w1] = level.start.launchWindow
  if (plan.launchTime < w0 - EPS || plan.launchTime > w1 + EPS) out.push({ kind: 'launch-window' })
  for (const n of plan.nodes) {
    if (!(n.dt > 0) || n.dt > level.horizon) out.push({ kind: 'node-time', nodeId: n.id })
  }
  return out
}

export type FailureReason =
  | 'over-budget'
  | 'too-many-burns'
  | 'launch-window'
  | 'node-time'
  | 'collision'
  | 'escaped'
  | 'missed'
  | 'deadline'
  | 'too-fast'
  | 'numerics'

export interface MissionOutcome {
  success: boolean
  failure: FailureReason | null
  stars: 0 | 1 | 2 | 3
  /** Δv of burns that actually fired (nodes after the end of the flight never fire) */
  spentDv: number
  plannedDv: number
  remainingDv: number
  /** arrival − launch for a success; end of trajectory − launch otherwise */
  flightTime: number
  arrivalTime: number | null
  closestToTarget: ApproachPoint | null
  collisionBody: BodyId | null
  collisionTime: number | null
  /** nodes scheduled after the trajectory ended */
  unexecutedNodeIds: string[]
  /** for missed flights: what went wrong, in actionable terms */
  miss: MissReport | null
  /** rendezvous goals: where the ship crossed the goal ring too fast, and how fast */
  fastPass: ApproachPoint | null
}

export function evaluateMission(
  level: LevelDef,
  mission: MissionSystem,
  plan: Plan,
  result: PropagationResult,
): MissionOutcome {
  const nodes = sortedNodes(plan)
  // for in-flight starts the first burn record is the immediate "launch" burn
  const executed = result.burns.slice(level.start.kind === 'orbit' ? 1 : 0).map((b) => b.applied)
  const spentNodes = nodes.reduce((s, n, i) => s + (executed[i] ? impulseMagnitude(n) : 0), 0)
  const spentDv = impulseMagnitude(plan.launch) + spentNodes
  const unexecutedNodeIds = nodes.filter((_, i) => !executed[i]).map((n) => n.id)
  const targetIndex = mission.indexOf(level.target.bodyId)
  const closestToTarget = result.arrival ?? result.closest[targetIndex] ?? null
  const flightTime = (result.arrival?.t ?? result.endTime) - plan.launchTime

  const base = {
    spentDv,
    plannedDv: plannedDv(plan),
    remainingDv: level.budget - spentDv,
    flightTime,
    arrivalTime: result.arrival?.t ?? null,
    closestToTarget,
    collisionBody: result.collision ? mission.ids[result.collision.bodyIndex] : null,
    collisionTime: result.collision?.t ?? null,
    unexecutedNodeIds,
    fastPass: result.fastPass,
  }

  const violation = checkPlan(level, plan)[0]
  let failure: FailureReason | null = violation ? violation.kind : null
  if (!failure) {
    switch (result.endReason) {
      case 'arrived':
        if (level.maxFlightTime !== null && flightTime > level.maxFlightTime + EPS) failure = 'deadline'
        break
      case 'collision':
        failure = 'collision'
        break
      case 'escaped':
        failure = 'escaped'
        break
      case 'step-limit':
        failure = 'numerics'
        break
      case 'timeout':
        failure = result.fastPass ? 'too-fast' : 'missed'
        break
    }
  }

  if (failure) {
    const miss = failure === 'missed' || failure === 'escaped' || failure === 'collision' ? analyzeMiss(level, mission, result) : null
    return { ...base, success: false, failure, stars: 0, miss }
  }

  let stars: 1 | 2 | 3 = 1
  if (spentDv <= level.stars.dvForTwo + EPS) stars = 2
  if (spentDv <= level.stars.dvForThree + EPS && flightTime <= level.stars.timeForThree + EPS) stars = 3
  return { ...base, success: true, failure: null, stars, miss: null }
}
