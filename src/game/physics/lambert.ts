/**
 * Lambert's problem in 2D around the star (universal variables, Curtis alg. 5.2): the heliocentric velocities that
 * take a body from r1 to r2 in time dt on a prograde, less-than-one-revolution arc. Used by the mission builder for
 * first guesses and by the game's window chart; the real hop is flown with the full propagator (planets pull too).
 */

function stumpffS(z: number): number {
  if (z > 1e-8) return (Math.sqrt(z) - Math.sin(Math.sqrt(z))) / Math.pow(z, 1.5)
  if (z < -1e-8) return (Math.sinh(Math.sqrt(-z)) - Math.sqrt(-z)) / Math.pow(-z, 1.5)
  return 1 / 6
}

function stumpffC(z: number): number {
  if (z > 1e-8) return (1 - Math.cos(Math.sqrt(z))) / z
  if (z < -1e-8) return (Math.cosh(Math.sqrt(-z)) - 1) / -z
  return 0.5
}

export interface LambertResult {
  v1x: number
  v1y: number
  v2x: number
  v2y: number
}

export function lambert(r1x: number, r1y: number, r2x: number, r2y: number, dt: number, mu = 1): LambertResult | null {
  const r1 = Math.hypot(r1x, r1y)
  const r2 = Math.hypot(r2x, r2y)
  const cross = r1x * r2y - r1y * r2x
  let theta = Math.acos(Math.max(-1, Math.min(1, (r1x * r2x + r1y * r2y) / (r1 * r2))))
  if (cross < 0) theta = 2 * Math.PI - theta
  if (Math.abs(1 - Math.cos(theta)) < 1e-10) return null
  const A = Math.sin(theta) * Math.sqrt((r1 * r2) / (1 - Math.cos(theta)))
  const y = (z: number) => r1 + r2 + (A * (z * stumpffS(z) - 1)) / Math.sqrt(stumpffC(z))
  const F = (z: number) => {
    const yz = y(z)
    if (yz < 0) return NaN
    return Math.pow(yz / stumpffC(z), 1.5) * stumpffS(z) + A * Math.sqrt(yz) - Math.sqrt(mu) * dt
  }
  // bracket the root: F grows with z on the single-revolution branch
  let lo = -4 * Math.PI * Math.PI
  while (Number.isNaN(F(lo)) || y(lo) < 0) {
    lo += 0.1
    if (lo > 4 * Math.PI * Math.PI) return null
  }
  let hi = 4 * Math.PI * Math.PI - 1e-6
  if (F(lo) > 0 || F(hi) < 0) return null
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2
    const fm = F(mid)
    if (Number.isNaN(fm) || fm < 0) lo = mid
    else hi = mid
    if (hi - lo < 1e-12) break
  }
  const z = (lo + hi) / 2
  const yz = y(z)
  const f = 1 - yz / r1
  const g = A * Math.sqrt(yz / mu)
  const gdot = 1 - yz / r2
  return {
    v1x: (r2x - f * r1x) / g,
    v1y: (r2y - f * r1y) / g,
    v2x: (gdot * r2x - r1x) / g,
    v2y: (gdot * r2y - r1y) / g,
  }
}
