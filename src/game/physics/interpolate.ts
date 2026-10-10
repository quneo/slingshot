/** Cubic Hermite interpolation of a ship state between two samples (positions + velocities known at both ends). */

export const SAMPLE_STRIDE = 5 // t, x, y, vx, vy

export interface ShipSample {
  t: number
  x: number
  y: number
  vx: number
  vy: number
}

export function hermite(
  t0: number, x0: number, y0: number, vx0: number, vy0: number,
  t1: number, x1: number, y1: number, vx1: number, vy1: number,
  t: number, out: ShipSample,
): ShipSample {
  const h = t1 - t0
  if (h <= 0) {
    out.t = t; out.x = x1; out.y = y1; out.vx = vx1; out.vy = vy1
    return out
  }
  const s = (t - t0) / h
  const s2 = s * s
  const s3 = s2 * s
  const h00 = 2 * s3 - 3 * s2 + 1
  const h10 = s3 - 2 * s2 + s
  const h01 = -2 * s3 + 3 * s2
  const h11 = s3 - s2
  const d00 = (6 * s2 - 6 * s) / h
  const d10 = 3 * s2 - 4 * s + 1
  const d01 = (-6 * s2 + 6 * s) / h
  const d11 = 3 * s2 - 2 * s
  out.t = t
  out.x = h00 * x0 + h10 * h * vx0 + h01 * x1 + h11 * h * vx1
  out.y = h00 * y0 + h10 * h * vy0 + h01 * y1 + h11 * h * vy1
  out.vx = d00 * x0 + d10 * vx0 + d01 * x1 + d11 * vx1
  out.vy = d00 * y0 + d10 * vy0 + d01 * y1 + d11 * vy1
  return out
}

/** Index i such that samples[i].t ≤ t < samples[i+1].t (clamped). Equal times (burns) resolve to the later sample. */
export function findSampleIndex(samples: Float64Array, count: number, t: number): number {
  if (count <= 1 || t <= samples[0]) return 0
  if (t >= samples[(count - 1) * SAMPLE_STRIDE]) return count - 1
  let lo = 0
  let hi = count - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (samples[mid * SAMPLE_STRIDE] <= t) lo = mid
    else hi = mid
  }
  return lo
}

/** Ship state at time t along a sampled trajectory (clamped to its time span). */
export function sampleTrajectory(samples: Float64Array, count: number, t: number, out: ShipSample): ShipSample {
  if (count === 0) {
    out.t = t; out.x = 0; out.y = 0; out.vx = 0; out.vy = 0
    return out
  }
  const i = findSampleIndex(samples, count, t)
  const a = i * SAMPLE_STRIDE
  if (i >= count - 1) {
    out.t = samples[a]; out.x = samples[a + 1]; out.y = samples[a + 2]; out.vx = samples[a + 3]; out.vy = samples[a + 4]
    return out
  }
  const b = a + SAMPLE_STRIDE
  return hermite(
    samples[a], samples[a + 1], samples[a + 2], samples[a + 3], samples[a + 4],
    samples[b], samples[b + 1], samples[b + 2], samples[b + 3], samples[b + 4],
    Math.min(Math.max(t, samples[a]), samples[b]), out,
  )
}

export const newSample = (): ShipSample => ({ t: 0, x: 0, y: 0, vx: 0, vy: 0 })
