/** Two-body Keplerian motion of planets around the fixed central star. */

export interface KeplerOrbit {
  /** semi-major axis, L0 */
  a: number
  /** eccentricity, 0 ≤ e < 1 */
  e: number
  /** argument of periapsis, rad */
  argPeri: number
  /** mean anomaly at t = 0, rad (for e = 0 this is simply the polar angle at t = 0) */
  meanAnomaly0: number
}

export interface StateVector {
  x: number
  y: number
  vx: number
  vy: number
}

export const meanMotion = (orbit: KeplerOrbit, muCentral: number): number => Math.sqrt(muCentral / orbit.a ** 3)
export const orbitalPeriod = (orbit: KeplerOrbit, muCentral: number): number => (2 * Math.PI) / meanMotion(orbit, muCentral)

export function solveKepler(meanAnomaly: number, e: number): number {
  const M = ((meanAnomaly % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
  let E = e < 0.8 ? M : Math.PI
  for (let i = 0; i < 30; i++) {
    const f = E - e * Math.sin(E) - M
    const dE = f / (1 - e * Math.cos(E))
    E -= dE
    if (Math.abs(dE) < 1e-14) break
  }
  return E
}

/** Writes the heliocentric state at time t into out[offset..offset+3]: x, y, vx, vy. */
export function keplerStateInto(orbit: KeplerOrbit, muCentral: number, t: number, out: Float64Array, offset: number): void {
  const n = meanMotion(orbit, muCentral)
  if (orbit.e === 0) {
    const theta = orbit.argPeri + orbit.meanAnomaly0 + n * t
    const c = Math.cos(theta)
    const s = Math.sin(theta)
    const v = n * orbit.a
    out[offset] = orbit.a * c
    out[offset + 1] = orbit.a * s
    out[offset + 2] = -v * s
    out[offset + 3] = v * c
    return
  }
  const E = solveKepler(orbit.meanAnomaly0 + n * t, orbit.e)
  const cosE = Math.cos(E)
  const sinE = Math.sin(E)
  const b = orbit.a * Math.sqrt(1 - orbit.e * orbit.e)
  const px = orbit.a * (cosE - orbit.e)
  const py = b * sinE
  const Edot = n / (1 - orbit.e * cosE)
  const pvx = -orbit.a * sinE * Edot
  const pvy = b * cosE * Edot
  const cw = Math.cos(orbit.argPeri)
  const sw = Math.sin(orbit.argPeri)
  out[offset] = px * cw - py * sw
  out[offset + 1] = px * sw + py * cw
  out[offset + 2] = pvx * cw - pvy * sw
  out[offset + 3] = pvx * sw + pvy * cw
}

export function keplerState(orbit: KeplerOrbit, muCentral: number, t: number): StateVector {
  const buf = new Float64Array(4)
  keplerStateInto(orbit, muCentral, t, buf, 0)
  return { x: buf[0], y: buf[1], vx: buf[2], vy: buf[3] }
}
