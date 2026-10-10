/** Explicit integrators for y' = f(t, y). All work in-place on Float64Array buffers (float64). */

export type Derivative = (t: number, y: Float64Array, out: Float64Array) => void

/** Classic fixed-step RK4; used by tests as an independent reference. */
export function rk4Step(f: Derivative, t: number, y: Float64Array, h: number, out: Float64Array): void {
  const n = y.length
  const k1 = new Float64Array(n)
  const k2 = new Float64Array(n)
  const k3 = new Float64Array(n)
  const k4 = new Float64Array(n)
  const tmp = new Float64Array(n)
  f(t, y, k1)
  for (let i = 0; i < n; i++) tmp[i] = y[i] + 0.5 * h * k1[i]
  f(t + 0.5 * h, tmp, k2)
  for (let i = 0; i < n; i++) tmp[i] = y[i] + 0.5 * h * k2[i]
  f(t + 0.5 * h, tmp, k3)
  for (let i = 0; i < n; i++) tmp[i] = y[i] + h * k3[i]
  f(t + h, tmp, k4)
  for (let i = 0; i < n; i++) out[i] = y[i] + (h / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i])
}

// Dormand–Prince 5(4) tableau
const A21 = 1 / 5
const A31 = 3 / 40, A32 = 9 / 40
const A41 = 44 / 45, A42 = -56 / 15, A43 = 32 / 9
const A51 = 19372 / 6561, A52 = -25360 / 2187, A53 = 64448 / 6561, A54 = -212 / 729
const A61 = 9017 / 3168, A62 = -355 / 33, A63 = 46732 / 5247, A64 = 49 / 176, A65 = -5103 / 18656
const B1 = 35 / 384, B3 = 500 / 1113, B4 = 125 / 192, B5 = -2187 / 6784, B6 = 11 / 84
const E1 = 71 / 57600, E3 = -71 / 16695, E4 = 71 / 1920, E5 = -17253 / 339200, E6 = 22 / 525, E7 = -1 / 40

export interface Tolerance {
  rtol: number
  atol: number
}

/**
 * One Dormand–Prince RK5(4) attempt with FSAL. Allocate once per propagation and reuse.
 * attempt() returns the scaled error norm; ≤ 1 means the step is acceptable.
 */
export class DormandPrince {
  readonly k2: Float64Array
  readonly k3: Float64Array
  readonly k4: Float64Array
  readonly k5: Float64Array
  readonly k6: Float64Array
  private readonly tmp: Float64Array

  constructor(
    private readonly dim: number,
    private readonly f: Derivative,
    private readonly tol: Tolerance,
  ) {
    this.k2 = new Float64Array(dim)
    this.k3 = new Float64Array(dim)
    this.k4 = new Float64Array(dim)
    this.k5 = new Float64Array(dim)
    this.k6 = new Float64Array(dim)
    this.tmp = new Float64Array(dim)
  }

  /**
   * @param k1 f(t, y) — supplied by the caller (FSAL)
   * @param yOut receives the 5th-order solution at t + h
   * @param k7 receives f(t + h, yOut), the next step's k1
   */
  attempt(t: number, y: Float64Array, h: number, k1: Float64Array, yOut: Float64Array, k7: Float64Array): number {
    const { dim, f, tmp, k2, k3, k4, k5, k6 } = this
    for (let i = 0; i < dim; i++) tmp[i] = y[i] + h * A21 * k1[i]
    f(t + h / 5, tmp, k2)
    for (let i = 0; i < dim; i++) tmp[i] = y[i] + h * (A31 * k1[i] + A32 * k2[i])
    f(t + (3 * h) / 10, tmp, k3)
    for (let i = 0; i < dim; i++) tmp[i] = y[i] + h * (A41 * k1[i] + A42 * k2[i] + A43 * k3[i])
    f(t + (4 * h) / 5, tmp, k4)
    for (let i = 0; i < dim; i++) tmp[i] = y[i] + h * (A51 * k1[i] + A52 * k2[i] + A53 * k3[i] + A54 * k4[i])
    f(t + (8 * h) / 9, tmp, k5)
    for (let i = 0; i < dim; i++)
      tmp[i] = y[i] + h * (A61 * k1[i] + A62 * k2[i] + A63 * k3[i] + A64 * k4[i] + A65 * k5[i])
    f(t + h, tmp, k6)
    for (let i = 0; i < dim; i++)
      yOut[i] = y[i] + h * (B1 * k1[i] + B3 * k3[i] + B4 * k4[i] + B5 * k5[i] + B6 * k6[i])
    f(t + h, yOut, k7)

    let sum = 0
    for (let i = 0; i < dim; i++) {
      const errI = h * (E1 * k1[i] + E3 * k3[i] + E4 * k4[i] + E5 * k5[i] + E6 * k6[i] + E7 * k7[i])
      const sc = this.tol.atol + this.tol.rtol * Math.max(Math.abs(y[i]), Math.abs(yOut[i]))
      const r = errI / sc
      sum += r * r
    }
    return Math.sqrt(sum / dim)
  }
}

/** Standard step-size update for a 5th-order method. */
export function nextStepFactor(errNorm: number): number {
  if (errNorm === 0) return 5
  return Math.min(5, Math.max(0.2, 0.9 * Math.pow(errNorm, -0.2)))
}
