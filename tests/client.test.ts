import { describe, expect, it } from 'vitest'
import { getLevel } from '../src/game/levels/levels'
import { planKey, type Plan } from '../src/game/rules/plan'
import { TrajectoryClient } from '../src/game/worker/client'
import type { PredictResponse } from '../src/game/worker/protocol'

// In Node there is no Worker: the client falls back to the same pipeline on the main thread,
// which still exercises its latest-wins request bookkeeping.

const settle = () => new Promise((r) => setTimeout(r, 20))

describe('trajectory client', () => {
  it('drops stale responses: only the newest plan reaches listeners', async () => {
    const level = getLevel('L1')
    const client = new TrajectoryClient(0)
    const got: PredictResponse[] = []
    client.subscribe((r) => got.push(r))
    const planA: Plan = { ...level.initialPlan, launch: { prograde: 0.05, radial: 0 } }
    const planB: Plan = { ...level.initialPlan, launch: { prograde: 0.12, radial: 0.01 } }
    client.request(level.id, planA, true)
    client.request(level.id, planB, true)
    await settle()
    await settle()
    expect(got.length).toBe(1)
    expect(got[0].planKey).toBe(planKey(planB))
    expect(got[0].requestId).toBe(client.latestRequestId)
    client.dispose()
  })

  it('debounces rapid edits into one computation', async () => {
    const level = getLevel('L1')
    const client = new TrajectoryClient(10)
    const got: PredictResponse[] = []
    client.subscribe((r) => got.push(r))
    for (let i = 0; i < 20; i++) client.request(level.id, { ...level.initialPlan, launch: { prograde: 0.05 + i * 0.003, radial: 0 } })
    await new Promise((r) => setTimeout(r, 60))
    expect(got.length).toBe(1)
    expect(got[0].planKey).toBe(planKey({ ...level.initialPlan, launch: { prograde: 0.05 + 19 * 0.003, radial: 0 } }))
    client.dispose()
  })
})
