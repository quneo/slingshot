/** Two-body orbital quantities relative to a central body (used by the physics tests). */

export const specificEnergy = (x: number, y: number, vx: number, vy: number, mu: number): number =>
  0.5 * (vx * vx + vy * vy) - mu / Math.hypot(x, y)

export const angularMomentum = (x: number, y: number, vx: number, vy: number): number => x * vy - y * vx
