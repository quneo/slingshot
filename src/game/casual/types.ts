import type { BodyId } from '../levels/catalog'

/** A rock on a circular orbit: no gravity, but flying into it ends the attempt. */
export interface Asteroid {
  orbitRadius: number
  phaseDeg: number
  radius: number
  sprite: number
}

/**
 * One casual mission. The player launches from `home` with a pull of at most `power`, may fire boosts in flight
 * (each up to `boostMax`, together at most `fuel`), and should reach the ring around `target`. Three stardust
 * clouds lie on the reference route: collecting them all means flying the "cool" path.
 */
export interface CasualLevel {
  id: string
  chapter: number
  /** 1-based number across the whole campaign */
  number: number
  title: string
  /** what to do, in a few words */
  goal: string
  /** shown while aiming in the first attempts */
  hint: string
  bodies: { id: BodyId; phaseDeg: number }[]
  home: BodyId
  target: { bodyId: BodyId; zoneRadius: number }
  /** stardust positions in the star's frame (they do not move) */
  stardust: [number, number][]
  asteroids: Asteroid[]
  /** longest launch Δv the pull gives, model units */
  power: number
  /** total Δv of all in-flight boosts, model units (0 = no boosts) */
  fuel: number
  /** Δv of one fully charged boost */
  boostMax: number
  /** how far ahead (model time) the aiming preview reaches */
  previewTime: number
  /** flight time of the reference route */
  refTime: number
  /** the attempt ends after this much flight time */
  horizon: number
  /** cruise playback speed: model time per real second */
  pace: number
  /** inertial launch Δv that collects all stardust and arrives (verified by tests) */
  reference: { dvx: number; dvy: number }
  /** aiming view */
  view: { x: number; y: number; radius: number }
}
