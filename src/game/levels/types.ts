import type { StateVector } from '../physics/ephemeris'
import type { Plan } from '../rules/plan'
import type { BodyId } from './catalog'

export type GoalKind = 'flyby' | 'rendezvous'

export interface LevelBody {
  id: BodyId
  /** polar angle at mission time 0, degrees (ignored for the star) */
  phaseDeg: number
}

export interface LevelTarget {
  bodyId: BodyId
  kind: GoalKind
  /** arrival zone radius around the body centre, model units */
  zoneRadius: number
  /** rendezvous only: maximal relative speed, model units */
  maxRelSpeed?: number
}

/** Ship waits at its home planet and departs with the launch burn (patched-conic departure). */
export interface DockedStart {
  kind: 'docked'
  bodyId: BodyId
  /** allowed launch times, model units; equal ends = fixed launch */
  launchWindow: [number, number]
}

/** Ship is already in flight at mission time 0; the "launch" burn fires immediately (it may be zero). */
export interface OrbitStart {
  kind: 'orbit'
  state: StateVector
  launchWindow: [0, 0]
}

export type LevelStart = DockedStart | OrbitStart

export interface StarThresholds {
  /** 2 stars: spent Δv ≤ this */
  dvForTwo: number
  /** 3 stars: spent Δv ≤ this AND flight time ≤ timeForThree */
  dvForThree: number
  timeForThree: number
}

export type TutorialStep = 'drag-impulse' | 'read-forecast' | 'launch' | 'launch-window' | 'add-node' | 'flyby'

export interface LevelDef {
  id: string
  number: number
  title: string
  /** one line for the campaign map */
  summary: string
  /** 1–2 sentences on the mission card */
  briefing: string
  difficulty: 1 | 2 | 3 | 4 | 5
  bodies: LevelBody[]
  start: LevelStart
  target: LevelTarget
  /** total engine Δv, model units */
  budget: number
  /** including the launch burn */
  maxBurns: number
  /** deadline on flight duration (arrival − launch), model units; null = none */
  maxFlightTime: number | null
  /** prediction horizon after launch, model units */
  horizon: number
  stars: StarThresholds
  initialPlan: Plan
  /** reference solution, verified by tests/levels.test.ts */
  solution: Plan
  hints: [string, string, string]
  /** hint 3 highlights this launch window on the timeline */
  hintWindow?: [number, number]
  /** hint 2 highlights this body */
  hintBody?: BodyId
  tutorial?: TutorialStep[]
  camera: { x: number; y: number; radius: number }
}
