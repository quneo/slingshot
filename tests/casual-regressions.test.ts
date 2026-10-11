import { describe, expect, it } from 'vitest'
import { getCasualLevel } from '../src/game/casual/levels'
import { isClosePass } from '../src/game/casual/scoring'
import { Flight } from '../src/game/casual/sim'
import { buildWorld } from '../src/game/casual/world'
import { departureRadius } from '../src/game/physics/propagate'
import { bodyState } from '../src/game/physics/system'

describe('boost regressions', () => {
  it('a boost after the ship came back to its home planet keeps the planet solid and pulling', () => {
    const level = getCasualLevel('c5')
    const world = buildWorld(level)
    const home = world.system.bodies[world.homeIndex]
    const limit = departureRadius(home)
    // find a weak throw that leaves the home planet and later comes back within its departure radius
    let found: { launch: { dvx: number; dvy: number }; t: number } | null = null
    for (let k = 0.1; k <= 0.3 && !found; k += 0.05) {
      for (let deg = 0; deg < 360 && !found; deg += 15) {
        const a = (deg * Math.PI) / 180
        const launch = { dvx: Math.cos(a) * level.power * k, dvy: Math.sin(a) * level.power * k }
        const f = new Flight(level, launch, world)
        let left = false
        for (let t = 0.05; t < f.end.t; t += 0.01) {
          const s = f.stateAt(t)
          const p = bodyState(world.system, world.homeIndex, t)
          const d = Math.hypot(s.x - p.x, s.y - p.y)
          if (d > limit * 1.5) left = true
          else if (left && d < limit * 0.9 && d > home.radius * 1.5) {
            found = { launch, t }
            break
          }
        }
      }
    }
    expect(found, 'no returning throw found').not.toBeNull()
    const f = new Flight(level, found!.launch, world)
    expect(f.boost(found!.t, 0, 1, 0)).toBe(true)
    expect(f.segments[1].departing).toBe(false)
    // the boosted path never enters the planet: it either misses it or stops on its surface
    for (let t = found!.t; t <= f.end.t; t += 0.0005) {
      const s = f.stateAt(t)
      const p = bodyState(world.system, world.homeIndex, t)
      expect(Math.hypot(s.x - p.x, s.y - p.y)).toBeGreaterThan(home.radius * 0.98)
    }
  })

  it('a boost right after the launch still leaves the home planet by the departure rules', () => {
    const level = getCasualLevel('c5')
    const f = new Flight(level, level.reference)
    expect(f.boost(0.002, 1, 0, 0)).toBe(true)
    expect(f.segments[1].departing).toBe(true)
  })

  it.each([1, -1])('a flyby cut by a boost reports the closest approach actually flown (side %i)', (side) => {
    const level = getCasualLevel('c5')
    const ref = new Flight(level, level.reference)
    const fb = ref.flybys().find((x) => ref.world.planetOf[x.bodyIndex] === 'colossus')!
    const f = new Flight(level, level.reference)
    const tBoost = fb.tIn + (fb.tOut - fb.tIn) * 0.1
    const v = f.stateAt(tBoost)
    // a full boost sideways early in the encounter: the unboosted periapsis never happens
    expect(f.boost(tBoost, -v.vy * side, v.vx * side, 1)).toBe(true)
    const rec = f.flybys().find((x) => x.bodyIndex === fb.bodyIndex)!
    let flown = Infinity
    for (let t = rec.tIn; t <= Math.min(rec.tOut, f.end.t); t += 0.0005) {
      const s = f.stateAt(t)
      const p = bodyState(f.world.system, fb.bodyIndex, t)
      flown = Math.min(flown, Math.hypot(s.x - p.x, s.y - p.y))
    }
    expect(Math.abs(rec.distance - flown)).toBeLessThan(2e-3)
    expect(Math.abs(rec.distance - fb.distance)).toBeGreaterThan(5e-3)
    expect(isClosePass(f, rec)).toBe(rec.distance < f.world.system.bodies[fb.bodyIndex].radius * 1.7)
  })
})
