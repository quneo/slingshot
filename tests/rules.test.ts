import { beforeEach, describe, expect, it } from 'vitest'
import { getLevel } from '../src/game/levels/levels'
import { fromDays } from '../src/game/physics/units'
import { impulseMagnitude, plannedDv, type Plan } from '../src/game/rules/plan'
import { predict } from '../src/game/worker/predict'
import { useGame } from '../src/state/gameStore'

describe('miss analysis gives actionable feedback', () => {
  it('L1 with a weak launch: the ship does not reach the orbit of the target', () => {
    const level = getLevel('L1')
    const res = predict(1, level.id, { ...level.initialPlan, launch: { prograde: 0.04, radial: 0 } })
    expect(res.outcome.failure).toBe('missed')
    expect(res.outcome.miss?.kind).toBe('short')
  })

  it('L2 launched too early: the planet arrives at the meeting point later', () => {
    const level = getLevel('L2')
    const res = predict(1, level.id, { ...level.solution, launchTime: 0 })
    expect(res.outcome.success).toBe(false)
    const miss = res.outcome.miss
    expect(miss?.kind).toBe('timing')
    if (miss?.kind === 'timing') {
      // the suggested shift lands near the real launch window
      expect(miss.launchShift).not.toBeNull()
      expect(Math.abs(miss.launchShift! - level.solution.launchTime)).toBeLessThan(1)
    }
  })

  it('L2 launched too late: the planet has already passed', () => {
    const level = getLevel('L2')
    const res = predict(1, level.id, { ...level.solution, launchTime: level.solution.launchTime + 2.2 })
    const miss = res.outcome.miss
    expect(res.outcome.success).toBe(false)
    expect(miss?.kind === 'timing' || miss?.kind === 'near').toBe(true)
    if (miss?.kind === 'timing') expect(miss.launchShift!).toBeLessThan(0)
  })
})

describe('store edits respect the rules', () => {
  beforeEach(() => {
    useGame.getState().startLevel('L3')
  })

  it('a dragged impulse is clamped to the Δv budget', () => {
    const level = getLevel('L3')
    useGame.getState().setLaunchImpulse({ prograde: level.budget * 3, radial: 0 })
    const plan = useGame.getState().plan
    expect(plannedDv(plan)).toBeLessThanOrEqual(level.budget + 1e-12)
    expect(impulseMagnitude(plan.launch)).toBeCloseTo(level.budget, 12)
  })

  it('a correction can only use what the launch left over', () => {
    const level = getLevel('L3')
    const s = useGame.getState()
    s.setLaunchImpulse({ prograde: level.budget * 0.8, radial: 0 })
    const id = useGame.getState().addNode(fromDays(100))!
    expect(id).toBeTruthy()
    useGame.getState().updateNode(id, { prograde: 1, radial: 0 })
    expect(plannedDv(useGame.getState().plan)).toBeCloseTo(level.budget, 12)
  })

  it('cannot add more burns than the level allows', () => {
    const level = getLevel('L3')
    expect(level.maxBurns).toBe(2)
    expect(useGame.getState().addNode(1)).toBeTruthy()
    expect(useGame.getState().addNode(2)).toBeNull()
  })

  it('launch date is kept inside the window; undo restores the previous plan', () => {
    const level = getLevel('L3')
    const before: Plan = useGame.getState().plan
    useGame.getState().setLaunchTime(999)
    expect(useGame.getState().plan.launchTime).toBe(level.start.launchWindow[1])
    useGame.getState().undo()
    expect(useGame.getState().plan.launchTime).toBe(before.launchTime)
  })
})
