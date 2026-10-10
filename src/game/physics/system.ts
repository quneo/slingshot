import { keplerStateInto, type KeplerOrbit, type StateVector } from './ephemeris'

export interface GravityBody {
  id: string
  /** gravitational parameter G·m in model units */
  mu: number
  /** physical radius used for collisions (never the enlarged render radius) */
  radius: number
  /** null → the body is fixed at the origin (the central star) */
  orbit: KeplerOrbit | null
  /** a closest approach inside this radius is reported as a gravity-assist flyby */
  influenceRadius: number
}

/** The ship is a test particle: it feels every body, bodies move on fixed Kepler orbits and ignore the ship. */
export interface PhysicsSystem {
  centralMu: number
  bodies: readonly GravityBody[]
}

export function bodyStatesInto(system: PhysicsSystem, t: number, out: Float64Array): void {
  const { bodies, centralMu } = system
  for (let i = 0; i < bodies.length; i++) {
    const orbit = bodies[i].orbit
    const o = i * 4
    if (orbit) {
      keplerStateInto(orbit, centralMu, t, out, o)
    } else {
      out[o] = 0
      out[o + 1] = 0
      out[o + 2] = 0
      out[o + 3] = 0
    }
  }
}

export function bodyState(system: PhysicsSystem, bodyIndex: number, t: number): StateVector {
  const body = system.bodies[bodyIndex]
  if (!body.orbit) return { x: 0, y: 0, vx: 0, vy: 0 }
  const buf = new Float64Array(4)
  keplerStateInto(body.orbit, system.centralMu, t, buf, 0)
  return { x: buf[0], y: buf[1], vx: buf[2], vy: buf[3] }
}

/**
 * dv/dt = −Σ μ_i (r − r_i) / |r − r_i|³.
 * `bodyStates` must already hold body positions for the same t.
 * Inside a body the distance is clamped to half its radius: the propagator stops at the surface,
 * so the clamp only protects intermediate RK stages from the singularity and never shapes a valid path.
 */
export function accelerationInto(
  system: PhysicsSystem,
  bodyStates: Float64Array,
  x: number,
  y: number,
  out: Float64Array,
  ignoredBody = -1,
): void {
  let ax = 0
  let ay = 0
  const bodies = system.bodies
  for (let i = 0; i < bodies.length; i++) {
    if (i === ignoredBody) continue
    const dx = x - bodyStates[i * 4]
    const dy = y - bodyStates[i * 4 + 1]
    const minR = bodies[i].radius * 0.5
    const r2 = Math.max(dx * dx + dy * dy, minR * minR, 1e-18)
    const r = Math.sqrt(r2)
    const k = -bodies[i].mu / (r2 * r)
    ax += k * dx
    ay += k * dy
  }
  out[0] = ax
  out[1] = ay
}

/** Derivative of the ship state y = [x, y, vx, vy]; uses `scratch` (4·n) for body states. */
export function shipDerivative(
  system: PhysicsSystem,
  t: number,
  state: Float64Array,
  scratch: Float64Array,
  out: Float64Array,
  ignoredBody = -1,
): void {
  bodyStatesInto(system, t, scratch)
  out[0] = state[2]
  out[1] = state[3]
  const acc = out.subarray(2, 4)
  accelerationInto(system, scratch, state[0], state[1], acc, ignoredBody)
}
