import { describe, expect, it } from 'vitest'
import { keplerState, solveKepler } from '../src/game/physics/ephemeris'
import { DormandPrince, rk4Step } from '../src/game/physics/integrators'
import { sampleTrajectory, newSample, SAMPLE_STRIDE } from '../src/game/physics/interpolate'
import { angularMomentum, specificEnergy } from '../src/game/physics/orbital'
import { burnToInertial, propagate, type PropagationInput } from '../src/game/physics/propagate'
import { bodyState, type PhysicsSystem } from '../src/game/physics/system'

const starOnly: PhysicsSystem = {
  centralMu: 1,
  bodies: [{ id: 'star', mu: 1, radius: 0.05, orbit: null, influenceRadius: 0 }],
}

function circularInput(r: number, periods: number, extra: Partial<PropagationInput> = {}): PropagationInput {
  const v = Math.sqrt(1 / r)
  return {
    system: starOnly,
    t0: 0,
    state0: { x: r, y: 0, vx: 0, vy: v },
    burns: [],
    tEnd: periods * 2 * Math.PI * Math.sqrt(r ** 3),
    target: null,
    escapeRadius: 100,
    departureBodyIndex: null,
    ...extra,
  }
}

const last = (res: { samples: Float64Array; sampleCount: number }) => {
  const o = (res.sampleCount - 1) * SAMPLE_STRIDE
  return { t: res.samples[o], x: res.samples[o + 1], y: res.samples[o + 2], vx: res.samples[o + 3], vy: res.samples[o + 4] }
}

describe('ephemeris', () => {
  it('solves Kepler equation', () => {
    for (const e of [0, 0.1, 0.5, 0.9]) {
      for (const M of [0.1, 1, 2.5, 4, 6]) {
        const E = solveKepler(M, e)
        expect(E - e * Math.sin(E)).toBeCloseTo(((M % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI), 12)
      }
    }
  })

  it('circular planet keeps radius and speed', () => {
    const orbit = { a: 2.6, e: 0, argPeri: 0, meanAnomaly0: 0.3 }
    for (const t of [0, 1.7, 10, 55.5]) {
      const s = keplerState(orbit, 1, t)
      expect(Math.hypot(s.x, s.y)).toBeCloseTo(2.6, 12)
      expect(Math.hypot(s.vx, s.vy)).toBeCloseTo(Math.sqrt(1 / 2.6), 12)
    }
  })

  it('elliptic orbit conserves energy and angular momentum', () => {
    const orbit = { a: 3, e: 0.4, argPeri: 0.7, meanAnomaly0: 0 }
    const s0 = keplerState(orbit, 1, 0)
    const e0 = specificEnergy(s0.x, s0.y, s0.vx, s0.vy, 1)
    const h0 = angularMomentum(s0.x, s0.y, s0.vx, s0.vy)
    expect(e0).toBeCloseTo(-1 / 6, 12)
    for (const t of [1, 4.4, 9.9]) {
      const s = keplerState(orbit, 1, t)
      expect(specificEnergy(s.x, s.y, s.vx, s.vy, 1)).toBeCloseTo(e0, 11)
      expect(angularMomentum(s.x, s.y, s.vx, s.vy)).toBeCloseTo(h0, 11)
    }
  })
})

describe('integrators', () => {
  it('RK4 and Dormand–Prince agree on a harmonic oscillator', () => {
    const f = (_t: number, y: Float64Array, out: Float64Array) => {
      out[0] = y[1]
      out[1] = -y[0]
    }
    const y = new Float64Array([1, 0])
    const out = new Float64Array(2)
    let t = 0
    for (let i = 0; i < 1000; i++, t += 0.01) {
      rk4Step(f, t, y, 0.01, out)
      y.set(out)
    }
    expect(y[0]).toBeCloseTo(Math.cos(10), 9)

    const dp = new DormandPrince(2, f, { rtol: 1e-9, atol: 1e-12 })
    const y2 = new Float64Array([1, 0])
    const k1 = new Float64Array(2)
    const k7 = new Float64Array(2)
    const yn = new Float64Array(2)
    f(0, y2, k1)
    t = 0
    for (let i = 0; i < 1000; i++, t += 0.01) {
      const err = dp.attempt(t, y2, 0.01, k1, yn, k7)
      expect(err).toBeLessThan(1)
      y2.set(yn)
      k1.set(k7)
    }
    expect(y2[0]).toBeCloseTo(Math.cos(10), 10)
  })
})

describe('1. two-body circular orbit', () => {
  it('keeps radius, energy and angular momentum over several revolutions', () => {
    const res = propagate(circularInput(1.5, 5))
    expect(res.endReason).toBe('timeout')
    const e0 = specificEnergy(1.5, 0, 0, Math.sqrt(1 / 1.5), 1)
    const h0 = angularMomentum(1.5, 0, 0, Math.sqrt(1 / 1.5))
    let maxDr = 0
    let maxDe = 0
    let maxDh = 0
    for (let i = 0; i < res.sampleCount; i++) {
      const o = i * SAMPLE_STRIDE
      const [x, y, vx, vy] = [res.samples[o + 1], res.samples[o + 2], res.samples[o + 3], res.samples[o + 4]]
      maxDr = Math.max(maxDr, Math.abs(Math.hypot(x, y) - 1.5))
      maxDe = Math.max(maxDe, Math.abs(specificEnergy(x, y, vx, vy, 1) - e0))
      maxDh = Math.max(maxDh, Math.abs(angularMomentum(x, y, vx, vy) - h0))
    }
    expect(maxDr).toBeLessThan(1e-7)
    expect(maxDe / Math.abs(e0)).toBeLessThan(1e-7)
    expect(maxDh / h0).toBeLessThan(1e-7)
    // back at the start after whole revolutions
    const end = last(res)
    expect(end.x).toBeCloseTo(1.5, 6)
    expect(end.y).toBeCloseTo(0, 6)
  })
})

describe('2–3. engine budget vs gravity', () => {
  it('a gravity assist changes heliocentric speed while engine Δv stays zero', () => {
    // coast on an ellipse to r = 2, then place the giant just ahead of the crossing point
    const state0 = { x: 1, y: 0, vx: 0, vy: 1.22 }
    const probe = propagate({ ...circularInput(1, 1), state0, tEnd: 10 })
    let tc = 0
    let thetaC = 0
    for (let i = 0; i < probe.sampleCount; i++) {
      const o = i * SAMPLE_STRIDE
      if (Math.hypot(probe.samples[o + 1], probe.samples[o + 2]) >= 2) {
        tc = probe.samples[o]
        thetaC = Math.atan2(probe.samples[o + 2], probe.samples[o + 1])
        break
      }
    }
    expect(tc).toBeGreaterThan(0)
    const n = Math.sqrt(1 / 8)
    const sys: PhysicsSystem = {
      centralMu: 1,
      bodies: [
        { id: 'star', mu: 1, radius: 0.05, orbit: null, influenceRadius: 0 },
        { id: 'giant', mu: 0.01, radius: 0.1, orbit: { a: 2, e: 0, argPeri: 0, meanAnomaly0: thetaC - n * tc + 0.12 }, influenceRadius: 0.4 },
      ],
    }
    const res = propagate({ system: sys, t0: 0, state0, burns: [], tEnd: 20, target: null, escapeRadius: 50, departureBodyIndex: null })
    const spent = res.burns.reduce((s, b) => s + (b.applied ? b.magnitude : 0), 0)
    expect(spent).toBe(0)
    expect(res.endReason).not.toBe('collision')
    const flyby = res.flybys.find((f) => f.complete)
    expect(flyby, 'expected a completed flyby').toBeDefined()
    expect(Math.abs(flyby!.speedOut - flyby!.speedIn)).toBeGreaterThan(0.02)
  })

  it('an impulse changes velocity by exactly the requested vector and costs its norm', () => {
    const tb = 0.8
    const coast = propagate(circularInput(1, 1, { tEnd: tb }))
    const before = last(coast)
    const burned = propagate(circularInput(1, 1, { tEnd: tb + 1e-9, burns: [{ t: tb, prograde: 0.07, radial: -0.03 }] }))
    const rec = burned.burns[0]
    expect(rec.applied).toBe(true)
    expect(rec.magnitude).toBeCloseTo(Math.hypot(0.07, -0.03), 14)
    const expected = burnToInertial(before.vx, before.vy, 0.07, -0.03)
    expect(rec.dvx).toBeCloseTo(expected.dvx, 12)
    expect(rec.dvy).toBeCloseTo(expected.dvy, 12)
    // the sample right after the burn has v_before + Δv
    const idx = burned.samples.findIndex((_, i) => i % SAMPLE_STRIDE === 0 && i > 0 && burned.samples[i] === tb && burned.samples[i + 3] !== before.vx)
    expect(idx).toBeGreaterThan(0)
    expect(burned.samples[idx + 3]).toBeCloseTo(before.vx + expected.dvx, 9)
    expect(burned.samples[idx + 4]).toBeCloseTo(before.vy + expected.dvy, 9)
  })

  it('prograde burn raises the orbit, retrograde lowers it', () => {
    const up = propagate(circularInput(1, 1, { burns: [{ t: 0, prograde: 0.1, radial: 0 }] }))
    const down = propagate(circularInput(1, 1, { burns: [{ t: 0, prograde: -0.1, radial: 0 }] }))
    const maxR = (r: typeof up) => {
      let m = 0
      for (let i = 0; i < r.sampleCount; i++) m = Math.max(m, Math.hypot(r.samples[i * 5 + 1], r.samples[i * 5 + 2]))
      return m
    }
    const minR = (r: typeof up) => {
      let m = Infinity
      for (let i = 0; i < r.sampleCount; i++) m = Math.min(m, Math.hypot(r.samples[i * 5 + 1], r.samples[i * 5 + 2]))
      return m
    }
    expect(maxR(up)).toBeGreaterThan(1.3)
    expect(minR(down)).toBeLessThan(0.75)
  })
})

describe('4. collisions', () => {
  it('detects a fast grazing collision that coarse sampling would skip', () => {
    // planet radius 0.02 directly across a straight fast path; ship speed 10
    const sys: PhysicsSystem = {
      centralMu: 1e-12,
      bodies: [
        { id: 'star', mu: 1e-12, radius: 0.01, orbit: null, influenceRadius: 0 },
        { id: 'rock', mu: 1e-9, radius: 0.02, orbit: { a: 3, e: 0, argPeri: 0, meanAnomaly0: 0 }, influenceRadius: 0 },
      ],
    }
    const rock = bodyState(sys, 1, 0)
    // aim 0.015 off the centre → inside the radius, chord of the disc
    const res = propagate({
      system: sys,
      t0: 0,
      state0: { x: rock.x - 2, y: rock.y + 0.015, vx: 10, vy: 0 },
      burns: [],
      tEnd: 1,
      target: null,
      escapeRadius: 100,
      departureBodyIndex: null,
      maxStep: 0.5,
    })
    expect(res.endReason).toBe('collision')
    expect(res.collision!.bodyIndex).toBe(1)
    expect(res.collision!.distance).toBeCloseTo(0.02, 6)
  })

  it('stops at the star surface instead of hitting the singularity', () => {
    const res = propagate(circularInput(1, 1, { state0: { x: 1, y: 0, vx: 0, vy: 0 } }))
    expect(res.endReason).toBe('collision')
    expect(res.collision!.bodyIndex).toBe(0)
    expect(res.collision!.distance).toBeCloseTo(0.05, 6)
    for (let i = 0; i < res.samples.length; i++) expect(Number.isFinite(res.samples[i])).toBe(true)
  })
})

describe('5. determinism', () => {
  it('same inputs give bit-identical trajectories; rendering resolution does not matter', () => {
    const input = circularInput(1, 2, { burns: [{ t: 1.3, prograde: 0.12, radial: 0.04 }] })
    const a = propagate(input)
    const b = propagate(input)
    expect(a.sampleCount).toBe(b.sampleCount)
    expect(Array.from(a.samples)).toEqual(Array.from(b.samples))
    // sampling for a 30 fps and a 144 fps renderer reads the same state at the same time
    const s30 = newSample()
    const s144 = newSample()
    for (const t of [0.5, 2.25, 7.1]) {
      sampleTrajectory(a.samples, a.sampleCount, t, s30)
      sampleTrajectory(b.samples, b.sampleCount, t, s144)
      expect(s30).toEqual(s144)
    }
  })
})

describe('6. events use physical coordinates', () => {
  it('arrival is decided by the physical zone radius, not the render size', () => {
    const sys: PhysicsSystem = {
      centralMu: 1e-12,
      bodies: [
        { id: 'star', mu: 1e-12, radius: 0.01, orbit: null, influenceRadius: 0 },
        { id: 'target', mu: 1e-9, radius: 0.02, orbit: { a: 3, e: 0, argPeri: 0, meanAnomaly0: 0 }, influenceRadius: 0 },
      ],
    }
    const p = bodyState(sys, 1, 0)
    const shoot = (offset: number) =>
      propagate({
        system: sys,
        t0: 0,
        state0: { x: p.x - 1, y: p.y + offset, vx: 1, vy: p.vy },
        burns: [],
        tEnd: 2,
        target: { bodyIndex: 1, zoneRadius: 0.1, maxRelSpeed: null },
        escapeRadius: 100,
        departureBodyIndex: null,
      })
    const inside = shoot(0.09)
    const outside = shoot(0.11)
    expect(inside.endReason).toBe('arrived')
    expect(inside.arrival!.distance).toBeCloseTo(0.1, 6)
    expect(outside.endReason).toBe('timeout')
    expect(outside.closest[1]!.distance).toBeCloseTo(0.11, 3)
  })

  it('rendezvous needs a low relative speed', () => {
    const sys: PhysicsSystem = {
      centralMu: 1e-12,
      bodies: [
        { id: 'star', mu: 1e-12, radius: 0.01, orbit: null, influenceRadius: 0 },
        { id: 'target', mu: 1e-9, radius: 0.02, orbit: { a: 3, e: 0, argPeri: 0, meanAnomaly0: 0 }, influenceRadius: 0 },
      ],
    }
    const p = bodyState(sys, 1, 0)
    const res = propagate({
      system: sys,
      t0: 0,
      state0: { x: p.x - 1, y: p.y, vx: 1, vy: p.vy },
      burns: [],
      tEnd: 2,
      target: { bodyIndex: 1, zoneRadius: 0.1, maxRelSpeed: 0.2 },
      escapeRadius: 100,
      departureBodyIndex: null,
    })
    expect(res.endReason).toBe('collision')
    expect(res.fastPass).not.toBeNull()
  })
})
