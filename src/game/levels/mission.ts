import type { StateVector } from '../physics/ephemeris'
import { burnToInertial, type LocalBurn, type PropagationInput } from '../physics/propagate'
import { bodyState, type PhysicsSystem } from '../physics/system'
import { sortedNodes, type Impulse, type Plan } from '../rules/plan'
import { CATALOG, STAR_MU, influenceRadius, type BodyId } from './catalog'
import type { LevelDef } from './types'

const DEG = Math.PI / 180

/** Physics view of a level: the star first, then the level's planets in catalog order. */
export interface MissionSystem {
  system: PhysicsSystem
  ids: BodyId[]
  indexOf: (id: BodyId) => number
}

export function buildMissionSystem(level: LevelDef): MissionSystem {
  const ids: BodyId[] = ['lyra', ...level.bodies.filter((b) => b.id !== 'lyra').map((b) => b.id)]
  const phase = new Map(level.bodies.map((b) => [b.id, b.phaseDeg]))
  const system: PhysicsSystem = {
    centralMu: STAR_MU,
    bodies: ids.map((id) => {
      const c = CATALOG[id]
      return {
        id,
        mu: c.mu,
        radius: c.radius,
        influenceRadius: influenceRadius(c),
        orbit:
          c.orbitRadius === null
            ? null
            : { a: c.orbitRadius, e: 0, argPeri: 0, meanAnomaly0: (phase.get(id) ?? 0) * DEG },
      }
    }),
  }
  const indexOf = (id: BodyId) => {
    const i = ids.indexOf(id)
    if (i < 0) throw new Error(`Body ${id} is not part of level`)
    return i
  }
  return { system, ids, indexOf }
}

/**
 * Ship state right after the launch burn (patched-conic departure): the ship leaves the planet's centre with
 * the planet's heliocentric velocity plus the launch Δv. See `departureBodyIndex` in physics/propagate.ts.
 */
export function launchState(system: PhysicsSystem, homeIndex: number, launchTime: number, launch: Impulse): StateVector {
  const home = bodyState(system, homeIndex, launchTime)
  const { dvx, dvy } = burnToInertial(home.vx, home.vy, launch.prograde, launch.radial)
  return { x: home.x, y: home.y, vx: home.vx + dvx, vy: home.vy + dvy }
}

export const ESCAPE_RADIUS = 9.5

export function buildPropagationInput(level: LevelDef, mission: MissionSystem, plan: Plan): PropagationInput {
  const start = level.start
  const t0 = start.kind === 'docked' ? plan.launchTime : 0
  const nodeBurns: LocalBurn[] = sortedNodes(plan).map((n) => ({ t: t0 + n.dt, prograde: n.prograde, radial: n.radial }))
  const homeIndex = start.kind === 'docked' ? mission.indexOf(start.bodyId) : null
  const state0 =
    start.kind === 'docked'
      ? launchState(mission.system, homeIndex!, t0, plan.launch)
      : { ...start.state }
  // in flight the "launch" impulse is an ordinary burn at t = 0
  const burns = start.kind === 'orbit' ? [{ t: 0, ...plan.launch }, ...nodeBurns] : nodeBurns
  return {
    system: mission.system,
    t0,
    state0,
    burns,
    tEnd: t0 + level.horizon,
    target: {
      bodyIndex: mission.indexOf(level.target.bodyId),
      zoneRadius: level.target.zoneRadius,
      maxRelSpeed: level.target.kind === 'rendezvous' ? (level.target.maxRelSpeed ?? 0) : null,
    },
    escapeRadius: ESCAPE_RADIUS,
    departureBodyIndex: homeIndex,
  }
}
