/** Two-body orbital quantities relative to a central body (used for HUD readouts and physics tests). */

export const specificEnergy = (x: number, y: number, vx: number, vy: number, mu: number): number =>
  0.5 * (vx * vx + vy * vy) - mu / Math.hypot(x, y)

export const angularMomentum = (x: number, y: number, vx: number, vy: number): number => x * vy - y * vx

export const circularSpeed = (r: number, mu: number): number => Math.sqrt(mu / r)
export const escapeSpeed = (r: number, mu: number): number => Math.sqrt((2 * mu) / r)

export interface ConicSummary {
  semiMajorAxis: number
  eccentricity: number
  periapsis: number
  /** Infinity for unbound orbits */
  apoapsis: number
  bound: boolean
}

export function conicFromState(x: number, y: number, vx: number, vy: number, mu: number): ConicSummary {
  const eps = specificEnergy(x, y, vx, vy, mu)
  const h = angularMomentum(x, y, vx, vy)
  const e = Math.sqrt(Math.max(0, 1 + (2 * eps * h * h) / (mu * mu)))
  const p = (h * h) / mu
  const periapsis = p / (1 + e)
  const bound = eps < 0
  const a = bound ? -mu / (2 * eps) : Infinity
  return { semiMajorAxis: a, eccentricity: e, periapsis, apoapsis: bound ? a * (1 + e) : Infinity, bound }
}

/** Hohmann transfer Δv for the departure burn between circular orbits r1 → r2 (no planetary escape). */
export const hohmannDepartureDv = (r1: number, r2: number, mu: number): number =>
  Math.sqrt(mu / r1) * (Math.sqrt((2 * r2) / (r1 + r2)) - 1)

export const hohmannTransferTime = (r1: number, r2: number, mu: number): number =>
  Math.PI * Math.sqrt(((r1 + r2) / 2) ** 3 / mu)
