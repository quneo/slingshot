import { describe, expect, it } from 'vitest'
import { LEVELS, getLevel } from '../src/game/levels/levels'
import type { LevelDef } from '../src/game/levels/types'
import { buildMissionSystem, buildPropagationInput } from '../src/game/levels/mission'
import { propagate } from '../src/game/physics/propagate'
import { checkPlan, evaluateMission } from '../src/game/rules/evaluate'
import { plannedDv, type Plan } from '../src/game/rules/plan'
import { predict } from '../src/game/worker/predict'

const run = (level: LevelDef, plan: Plan) => predict(1, level.id, plan)

/** Cheap plans found by tools/optimize.ts (`three` mode); they prove the 3-star thresholds are reachable. */
const THREE_STAR: Record<string, Plan> = {
  L1: { launchTime: 0, launch: { prograde: 0.097064042716503, radial: 0.023453097578282088 }, nodes: [] },
  L2: { launchTime: 5.849115837539011, launch: { prograde: 0.15862660716030424, radial: 0.003893563796667515 }, nodes: [] },
  L3: { launchTime: 2.9128148563599505, launch: { prograde: 0.21176207781419362, radial: 0.0026447070193079607 }, nodes: [] },
  L4: { launchTime: 0, launch: { prograde: -0.008760591369606434, radial: -0.001995678091584837 }, nodes: [] },
  L5: { launchTime: 2.0101087003628733, launch: { prograde: 0.24363213394082348, radial: 0.004865158465761792 }, nodes: [] },
}

describe('7. every shipped level has a reproducible winning solution', () => {
  it('ships five levels', () => {
    expect(LEVELS.map((l) => l.id)).toEqual(['L1', 'L2', 'L3', 'L4', 'L5'])
  })

  for (const level of LEVELS) {
    describe(`${level.id} ${level.title}`, () => {
      it('reference solution reaches the target within budget, burn limit and deadline', () => {
        expect(checkPlan(level, level.solution)).toEqual([])
        const res = run(level, level.solution)
        expect(res.outcome.failure).toBeNull()
        expect(res.outcome.success).toBe(true)
        expect(res.result.endReason).toBe('arrived')
        expect(res.outcome.spentDv).toBeLessThanOrEqual(level.budget)
        if (level.maxFlightTime !== null) expect(res.outcome.flightTime).toBeLessThanOrEqual(level.maxFlightTime)
        expect(res.result.arrival!.distance).toBeLessThanOrEqual(level.target.zoneRadius + 1e-9)
      })

      it('solution replays bit-identically', () => {
        const a = run(level, level.solution)
        const b = run(level, level.solution)
        expect(Array.from(a.result.samples)).toEqual(Array.from(b.result.samples))
      })

      it('the starting plan does not already win', () => {
        expect(run(level, level.initialPlan).outcome.success).toBe(false)
      })

      it('star thresholds are ordered and 3 stars are reachable', () => {
        expect(level.stars.dvForThree).toBeLessThanOrEqual(level.stars.dvForTwo)
        expect(level.stars.dvForTwo).toBeLessThanOrEqual(level.budget)
        const res = run(level, THREE_STAR[level.id])
        expect(res.outcome.success).toBe(true)
        expect(res.outcome.stars).toBe(3)
      })

      it('the launch window and hint window are consistent', () => {
        const [w0, w1] = level.start.launchWindow
        expect(level.solution.launchTime).toBeGreaterThanOrEqual(w0)
        expect(level.solution.launchTime).toBeLessThanOrEqual(w1)
        if (level.hintWindow) {
          expect(level.hintWindow[0]).toBeLessThanOrEqual(level.solution.launchTime)
          expect(level.hintWindow[1]).toBeGreaterThanOrEqual(level.solution.launchTime)
        }
      })
    })
  }
})

describe('gravity assists in the design are real', () => {
  it('L3 and L5 solutions fly by the giants without spending engine Δv on it', () => {
    for (const id of ['L3', 'L5']) {
      const level = getLevel(id)
      const res = run(level, level.solution)
      const assisted = res.result.flybys.filter((f) => f.complete)
      expect(assisted.length).toBeGreaterThanOrEqual(id === 'L5' ? 2 : 1)
      // engine Δv is exactly the planned impulses, independent of what the flybys did
      expect(res.outcome.spentDv).toBeCloseTo(plannedDv(level.solution), 12)
    }
  })

  it('L4: without a burn the probe misses home', () => {
    const level = getLevel('L4')
    const res = run(level, level.initialPlan)
    expect(res.outcome.success).toBe(false)
    expect(res.outcome.spentDv).toBe(0)
  })
})

describe('8. limits are enforced by the rules, not by the UI', () => {
  const level = getLevel('L3')

  it('over-budget plan fails even if it would reach the target', () => {
    const plan: Plan = { ...level.solution, launch: { prograde: level.budget + 0.05, radial: 0 } }
    const res = run(level, plan)
    expect(res.outcome.success).toBe(false)
    expect(res.outcome.failure).toBe('over-budget')
  })

  it('too many burns fails', () => {
    const plan: Plan = {
      ...level.solution,
      nodes: [
        { id: 'a', dt: 1, prograde: 0, radial: 0 },
        { id: 'b', dt: 2, prograde: 0, radial: 0 },
      ],
    }
    expect(checkPlan(level, plan).map((v) => v.kind)).toContain('too-many-burns')
    expect(run(level, plan).outcome.failure).toBe('too-many-burns')
  })

  it('launching outside the window fails', () => {
    const plan: Plan = { ...level.solution, launchTime: level.start.launchWindow[1] + 1 }
    expect(run(level, plan).outcome.failure).toBe('launch-window')
  })

  it('arriving after the deadline fails', () => {
    // same trajectory, judged against a tighter deadline by the rule layer
    const strict: LevelDef = { ...level, maxFlightTime: 1 }
    const mission = buildMissionSystem(strict)
    const result = propagate(buildPropagationInput(strict, mission, level.solution))
    expect(result.endReason).toBe('arrived')
    expect(evaluateMission(strict, mission, level.solution, result).failure).toBe('deadline')
  })

  it('zero-Δv nodes cost nothing and change nothing', () => {
    const plan: Plan = { ...level.solution, nodes: [{ id: 'z', dt: 2, prograde: 0, radial: 0 }] }
    const a = run(level, level.solution)
    const b = run(level, plan)
    expect(b.outcome.spentDv).toBeCloseTo(a.outcome.spentDv, 15)
    expect(b.outcome.success).toBe(true)
  })
})
