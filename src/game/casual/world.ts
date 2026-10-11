import { CATALOG, STAR_MU, influenceRadius, type BodyId } from '../levels/catalog'
import type { StateVector } from '../physics/ephemeris'
import { bodyState, type GravityBody, type PhysicsSystem } from '../physics/system'
import type { Mission } from './types'

const DEG = Math.PI / 180

/** Physics view of a mission: star, planets, then asteroids (massless, but solid). */
export interface CasualWorld {
  system: PhysicsSystem
  /** catalog id for star/planets, null for asteroids */
  planetOf: (BodyId | null)[]
  /** index of the first asteroid body (all following ones are asteroids) */
  firstRock: number
  indexOf: (id: BodyId) => number
  /**
   * The system as seen from a ship leaving planet `origin`: that planet does not pull. The ship sits on a loose
   * parking orbit there, so the throw it is given is already its speed relative to the planet.
   */
  systemFrom: (origin: number) => PhysicsSystem
}

export function buildWorld(mission: Mission): CasualWorld {
  const ids: BodyId[] = ['lyra', ...mission.bodies.filter((b) => b.id !== 'lyra').map((b) => b.id)]
  const phase = new Map(mission.bodies.map((b) => [b.id, b.phaseDeg]))
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
  const rocks: GravityBody[] = mission.asteroids.map((a, i) => ({
    id: `rock-${i}`,
    mu: 0,
    radius: a.radius,
    influenceRadius: 0,
    orbit: { a: a.orbitRadius, e: 0, argPeri: 0, meanAnomaly0: a.phaseDeg * DEG },
  }))
  const system: PhysicsSystem = { centralMu: STAR_MU, bodies: [...planets, ...rocks] }
  const from = new Map<number, PhysicsSystem>()
  return {
    system,
    planetOf: [...ids, ...rocks.map(() => null)],
    firstRock: planets.length,
    indexOf: (id) => {
      const i = ids.indexOf(id)
      if (i < 0) throw new Error(`${id} is not in this mission`)
      return i
    },
    systemFrom: (origin) => {
      let s = from.get(origin)
      if (!s) {
        s = { ...system, bodies: system.bodies.map((b, i) => (i === origin ? { ...b, mu: 0 } : b)) }
        from.set(origin, s)
      }
      return s
    },
  }
}

/** A throw from planet `origin` at time t: the planet's own motion plus the inertial Δv. */
export function launchState(world: CasualWorld, origin: number, t: number, dvx: number, dvy: number): StateVector {
  const p = bodyState(world.system, origin, t)
  return { x: p.x, y: p.y, vx: p.vx + dvx, vy: p.vy + dvy }
}

/** Arriving slower than this (relative to the planet, at the edge of its zone) the planet captures the ship by itself. */
export function freeCaptureSpeed(world: CasualWorld, target: number, zoneRadius: number): number {
  return Math.sqrt((2 * world.system.bodies[target].mu) / zoneRadius)
}
