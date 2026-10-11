import { CATALOG, STAR_MU, influenceRadius, type BodyId } from '../levels/catalog'
import type { StateVector } from '../physics/ephemeris'
import { bodyState, type GravityBody, type PhysicsSystem } from '../physics/system'
import type { CasualLevel } from './types'

const DEG = Math.PI / 180

/** Physics view of a casual level: star, planets, then asteroids (massless, but solid). */
export interface CasualWorld {
  system: PhysicsSystem
  /** catalog id for star/planets, null for asteroids */
  planetOf: (BodyId | null)[]
  homeIndex: number
  targetIndex: number
  /** index of the first asteroid body (all following ones are asteroids) */
  firstRock: number
}

export function buildWorld(level: CasualLevel): CasualWorld {
  const ids: BodyId[] = ['lyra', ...level.bodies.filter((b) => b.id !== 'lyra').map((b) => b.id)]
  const phase = new Map(level.bodies.map((b) => [b.id, b.phaseDeg]))
  const planets: GravityBody[] = ids.map((id) => {
    const c = CATALOG[id]
    return {
      id,
      mu: c.mu,
      radius: c.radius,
      influenceRadius: influenceRadius(c),
      orbit: c.orbitRadius === null ? null : { a: c.orbitRadius, e: 0, argPeri: 0, meanAnomaly0: (phase.get(id) ?? 0) * DEG },
    }
  })
  const rocks: GravityBody[] = level.asteroids.map((a, i) => ({
    id: `rock-${i}`,
    mu: 0,
    radius: a.radius,
    influenceRadius: 0,
    orbit: { a: a.orbitRadius, e: 0, argPeri: 0, meanAnomaly0: a.phaseDeg * DEG },
  }))
  return {
    system: { centralMu: STAR_MU, bodies: [...planets, ...rocks] },
    planetOf: [...ids, ...rocks.map(() => null)],
    homeIndex: ids.indexOf(level.home),
    targetIndex: ids.indexOf(level.target.bodyId),
    firstRock: planets.length,
  }
}

/** Launch from the home planet at mission time 0 with an inertial Δv (patched-conic departure). */
export function launchFrom(world: CasualWorld, dvx: number, dvy: number): StateVector {
  const home = bodyState(world.system, world.homeIndex, 0)
  return { x: home.x, y: home.y, vx: home.vx + dvx, vy: home.vy + dvy }
}
