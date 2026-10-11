import type { BodyId } from '../levels/catalog'

/** A rock on a circular orbit: no gravity, but flying into it ends the attempt. */
export interface Asteroid {
  orbitRadius: number
  phaseDeg: number
  radius: number
  sprite: number
}

/** One jump of a mission: from the planet the ship is parked at to the next one. */
export interface Hop {
  /** where the ship parks next */
  to: BodyId
  /** reaching this distance from the planet's centre counts as arrival */
  zoneRadius: number
  /** a flight longer than this (model time) is lost in space */
  maxFlight: number
  /** how far ahead the aiming forecast reaches, model time */
  previewTime: number
  /** model time per real second while parked before this hop: the clock the player waits on */
  parkPace: number
  /** cruise playback speed in flight, model time per real second */
  flightPace: number
  /** reference plan: launch `wait` after parking at the origin, with this throw (inertial Δv) */
  reference: { wait: number; dvx: number; dvy: number }
  /** the reference flight's time from launch to arrival, and its Δv (launch + capture) */
  refFlight: number
  refCost: number
  /** framing while this hop is planned and flown */
  view: { x: number; y: number; radius: number }
}

/**
 * A mission: hop from planet to planet on one tank. The planets keep moving, so every hop has launch windows —
 * moments when it is cheap. Fuel goes on launches, on captures (arriving faster than the target's escape speed)
 * and on boosts in flight. Stars measure how close the total Δv came to the reference plan.
 */
export interface Mission {
  id: string
  chapter: number
  /** 1-based number across the campaign */
  number: number
  title: string
  /** what to do, in a few words */
  goal: string
  /** shown while waiting for the first window */
  hint: string
  bodies: { id: BodyId; phaseDeg: number }[]
  start: BodyId
  hops: Hop[]
  asteroids: Asteroid[]
  /** the tank: total Δv for the whole mission, model units */
  fuel: number
  /** longest single throw */
  power: number
  /** Δv of one fully charged boost */
  boostMax: number
  /** total Δv of the reference plan */
  refCost: number
  /** total Δv for three and for two stars */
  stars: [number, number]
  /** the whole mission must end before this model time (null = no deadline) */
  deadline: number | null
}
