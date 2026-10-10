import { describe, expect, it } from 'vitest'
import { getLevel } from '../src/game/levels/levels'
import { planKey, type Plan } from '../src/game/rules/plan'
import { TrajectoryClient } from '../src/game/worker/client'
import type { PredictResponse } from '../src/game/worker/protocol'

// In Node there is no Worker: the client falls back to the same pipeline on the main thread,
// which still exercises its latest-wins request bookkeeping.

const settle = () => new Promise((r) => setTimeout(r, 20))
const planWith = (prograde: number): Plan => ({ ...getLevel('L1').initialPlan, launch: { prograde, radial: 0 } })

describe('trajectory client', () => {
  it('drops stale responses: only the newest plan reaches listeners', async () => {
    const client = new TrajectoryClient()
    const got: PredictResponse[] = []
    client.subscribe((r) => got.push(r))
    client.request('L1', planWith(0.05))
    client.request('L1', planWith(0.12))
    await settle()
    await settle()
    expect(got.length).toBe(1)
    expect(got[0].planKey).toBe(planKey(planWith(0.12)))
    expect(got[0].requestId).toBe(client.latestRequestId)
    client.dispose()
  })

  it('a burst of edits costs one computation in flight plus the newest one, not one per edit', async () => {
    const client = new TrajectoryClient()
    const got: PredictResponse[] = []
    client.subscribe((r) => got.push(r))
    for (let i = 0; i < 20; i++) client.request('L1', planWith(0.05 + i * 0.003))
    await settle()
    await settle()
    expect(got.length).toBe(1)
    expect(got[0].planKey).toBe(planKey(planWith(0.05 + 19 * 0.003)))
    client.dispose()
  })

  it('keeps answering during a continuous drag (no debounce starvation)', async () => {
    const client = new TrajectoryClient()
    const got: PredictResponse[] = []
    client.subscribe((r) => got.push(r))
    // an edit every 8 ms for 160 ms, like a 125 Hz mouse
    for (let i = 0; i < 20; i++) {
      client.request('L1', planWith(0.05 + i * 0.003))
      await new Promise((r) => setTimeout(r, 8))
    }
    expect(got.length).toBeGreaterThanOrEqual(10)
    client.dispose()
  })
})
