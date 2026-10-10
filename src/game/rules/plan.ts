/** The player's flight plan: only physically meaningful inputs — launch moment and impulsive burns. */

export interface Impulse {
  /** model speed units, along the heliocentric velocity */
  prograde: number
  /** model speed units, perpendicular to the velocity, + = away from the star */
  radial: number
}

export interface BurnNode extends Impulse {
  id: string
  /** time after launch, model units */
  dt: number
}

export interface Plan {
  /** absolute mission time of launch, model units */
  launchTime: number
  /** launch burn applied at the departure station */
  launch: Impulse
  /** additional mid-course burns, at most level.maxBurns − 1 */
  nodes: BurnNode[]
}

export const impulseMagnitude = (i: Impulse): number => Math.hypot(i.prograde, i.radial)

/** Total Δv the plan asks the engine for (every planned burn, including the launch). */
export function plannedDv(plan: Plan): number {
  return plan.nodes.reduce((sum, n) => sum + impulseMagnitude(n), impulseMagnitude(plan.launch))
}

export const burnCount = (plan: Plan): number => 1 + plan.nodes.length

export function sortedNodes(plan: Plan): BurnNode[] {
  return [...plan.nodes].sort((a, b) => a.dt - b.dt)
}

export function clonePlan(plan: Plan): Plan {
  return { launchTime: plan.launchTime, launch: { ...plan.launch }, nodes: plan.nodes.map((n) => ({ ...n })) }
}

/** Stable string key: same plan → same key (used to match predictions to plans). */
export function planKey(plan: Plan): string {
  const r = (v: number) => v.toPrecision(12)
  const nodes = sortedNodes(plan).map((n) => `${r(n.dt)}:${r(n.prograde)}:${r(n.radial)}`)
  return `${r(plan.launchTime)}|${r(plan.launch.prograde)}:${r(plan.launch.radial)}|${nodes.join(';')}`
}

let nodeCounter = 0
export const newNodeId = (): string => `n${Date.now().toString(36)}${(nodeCounter++).toString(36)}`
