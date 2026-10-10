import { beforeEach, describe, expect, it } from 'vitest'
import { getLevel } from '../src/game/levels/levels'
import { flightClock } from '../src/state/flightClock'
import { levelProgress, useGame } from '../src/state/gameStore'
import { forecastRef } from '../src/state/prediction'
import { predict } from '../src/game/worker/predict'

/** Puts a fresh forecast for the current plan in place, as the worker would. */
function forecastNow() {
  const s = useGame.getState()
  const res = predict(999, s.levelId, s.plan)
  forecastRef.current = res
  ;(useGame.getState() as unknown as { __receiveForecast: (r: typeof res) => void }).__receiveForecast(res)
}

function flyToEnd() {
  flightClock.seek(flightClock.endTime)
  flightClock.finished = true
  useGame.getState().completeFlight()
  useGame.getState().showResult()
}

describe('flight bookkeeping', () => {
  beforeEach(() => {
    useGame.getState().resetProgress()
    useGame.getState().startLevel('L1')
    useGame.getState().setLaunchImpulse(getLevel('L1').solution.launch)
    forecastNow()
  })

  it('an arrival is saved even if the player leaves before the result screen', () => {
    useGame.getState().launch()
    expect(useGame.getState().phase).toBe('flight')
    flightClock.seek(flightClock.endTime)
    flightClock.finished = true
    useGame.getState().backToPlanning()
    const prog = levelProgress(useGame.getState().save, 'L1')
    expect(prog.completed).toBe(true)
    expect(prog.attempts.length).toBe(1)
  })

  it('replaying a flight does not record another attempt', () => {
    useGame.getState().launch()
    flyToEnd()
    expect(useGame.getState().phase).toBe('result')
    useGame.getState().replayFlight()
    flyToEnd()
    const prog = levelProgress(useGame.getState().save, 'L1')
    expect(prog.attempts.length).toBe(1)
    expect(useGame.getState().report?.isNewBest).toBe(true)
  })

  it('a new launch of the same plan is a new attempt', () => {
    useGame.getState().launch()
    flyToEnd()
    useGame.getState().backToPlanning()
    useGame.getState().launch()
    flyToEnd()
    expect(levelProgress(useGame.getState().save, 'L1').attempts.length).toBe(2)
  })
})

describe('edits and the launch queue', () => {
  beforeEach(() => {
    useGame.getState().startLevel('L3')
  })

  it('a slider press without movement does not swallow later undo steps', () => {
    const s = useGame.getState()
    const depth = s.undoStack.length
    s.beginGesture()
    s.endGesture()
    useGame.getState().setLaunchImpulse({ prograde: 0.1, radial: 0 })
    useGame.getState().setLaunchImpulse({ prograde: 0.12, radial: 0 })
    useGame.getState().setLaunchImpulse({ prograde: 0.14, radial: 0 })
    expect(useGame.getState().undoStack.length).toBe(depth + 3)
  })

  it('a drag is one undo step, pushed only once something changes', () => {
    const depth = useGame.getState().undoStack.length
    useGame.getState().beginGesture()
    expect(useGame.getState().undoStack.length).toBe(depth)
    useGame.getState().setLaunchImpulse({ prograde: 0.1, radial: 0 })
    useGame.getState().setLaunchImpulse({ prograde: 0.11, radial: 0 })
    useGame.getState().endGesture()
    expect(useGame.getState().undoStack.length).toBe(depth + 1)
  })

  it('a queued launch is cancelled by an edit or by leaving the level', () => {
    // a fresh edit has no forecast yet → the launch waits for it
    useGame.getState().setLaunchImpulse({ prograde: 0.205, radial: 0 })
    useGame.getState().launch()
    expect(useGame.getState().launchQueued).toBe(true)
    useGame.getState().setLaunchImpulse({ prograde: 0.21, radial: 0 })
    expect(useGame.getState().launchQueued).toBe(false)

    useGame.getState().launch()
    useGame.getState().openMenu()
    expect(useGame.getState().launchQueued).toBe(false)
    forecastNow()
    expect(useGame.getState().phase).toBe('plan')
  })
})
