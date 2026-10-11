import { describe, expect, it } from 'vitest'
import { CHAPTERS, getMission, MISSIONS } from '../src/game/casual/levels'
import { emptySave, missionOpen, totalStars, withResult } from '../src/game/casual/progress'
import { FAIL_PAUSE, Session, type GameEvent } from '../src/game/casual/session'
import { captureCost, Flight, forecastHop, hopContext, MIN_CHARGE } from '../src/game/casual/sim'
import type { Mission } from '../src/game/casual/types'
import { buildWorld, launchState } from '../src/game/casual/world'
import { departureRadius } from '../src/game/physics/propagate'
import { bodyState } from '../src/game/physics/system'

/** Runs the clock at 60 Hz until `until` says stop (or the phase settles). */
function run(s: Session, until: (s: Session) => boolean, events: GameEvent[] = [], limit = 400000): GameEvent[] {
  for (let i = 0; i < limit && !until(s); i++) {
    s.update(1 / 60)
    events.push(...s.drain())
  }
  return events
}

/** Flies a mission's reference plan as a player would: wait for each window, pull exactly, release. */
function playReference(m: Mission): { session: Session; events: GameEvent[] } {
  const s = new Session(m)
  const events: GameEvent[] = []
  for (let guard = 0; guard < 400000 && s.phase !== 'complete' && s.phase !== 'failed'; guard++) {
    const hop = m.hops[s.hopIndex]
    if (s.phase === 'parked') {
      const at = s.checkpoint.t + hop.reference.wait
      if (s.t + hop.parkPace / 60 < at) s.update(1 / 60)
      else {
        s.t = at
        s.setAim(hop.reference.dvx, hop.reference.dvy)
        expect(s.launch()).toBe(true)
      }
    } else s.update(1 / 60)
    events.push(...s.drain())
  }
  return { session: s, events }
}

/** The reference throw expressed in the planet's own frame (along / across its motion), re-applied at time t. */
function sameThrowAt(m: Mission, hopIndex: number, tRef: number, t: number): { dvx: number; dvy: number } {
  const w = buildWorld(m)
  const ctx = hopContext(m, w, hopIndex)
  const ref = m.hops[hopIndex].reference
  const frame = (tt: number) => {
    const p = bodyState(w.system, ctx.origin, tt)
    const v = Math.hypot(p.vx, p.vy)
    return { ux: p.vx / v, uy: p.vy / v }
  }
  const a = frame(tRef)
  const along = ref.dvx * a.ux + ref.dvy * a.uy
  const across = -ref.dvx * a.uy + ref.dvy * a.ux
  const b = frame(t)
  return { dvx: along * b.ux - across * b.uy, dvy: along * b.uy + across * b.ux }
}

describe('missions', () => {
  it('are numbered in order, grouped into chapters, with sane tanks and stars', () => {
    expect(MISSIONS.length).toBeGreaterThanOrEqual(12)
    MISSIONS.forEach((m, i) => {
      expect(m.number).toBe(i + 1)
      expect(CHAPTERS.some((c) => c.number === m.chapter)).toBe(true)
      expect(m.hops.length).toBeGreaterThanOrEqual(1)
      expect(m.stars[0]).toBeLessThan(m.stars[1])
      expect(m.stars[1]).toBeLessThanOrEqual(m.fuel)
      expect(m.refCost).toBeLessThan(m.stars[0])
      m.hops.forEach((h) => {
        expect(h.reference.wait).toBeGreaterThanOrEqual(0)
        expect(h.previewTime).toBeGreaterThan(0)
        expect(h.maxFlight).toBeGreaterThan(h.refFlight)
      })
    })
    expect(new Set(MISSIONS.map((m) => m.id)).size).toBe(MISSIONS.length)
  })

  it.each(MISSIONS.map((m) => [m.id, m.title] as const))('%s %s: the reference plan finishes with three stars', (id) => {
    const m = getMission(id)
    const { session, events } = playReference(m)
    expect(session.phase).toBe('complete')
    expect(session.result!.stars).toBe(3)
    expect(session.result!.spent).toBeCloseTo(m.refCost, 4)
    expect(events.filter((e) => e.kind === 'captured')).toHaveLength(m.hops.length)
    if (m.deadline !== null) expect(session.t).toBeLessThan(m.deadline)
  })
})

describe('launch windows', () => {
  it('the same throw a quarter of a synodic period late is much dearer or misses', () => {
    for (const id of ['m1', 'm3', 'm5']) {
      const m = getMission(id)
      const w = buildWorld(m)
      const ctx = hopContext(m, w, 0)
      const hop = m.hops[0]
      const rA = w.system.bodies[ctx.origin].orbit!.a
      const rB = w.system.bodies[ctx.target].orbit!.a
      const synodic = (2 * Math.PI) / Math.abs(Math.pow(rA, -1.5) - Math.pow(rB, -1.5))
      const late = hop.reference.wait + synodic / 4
      const throwLate = sameThrowAt(m, 0, hop.reference.wait, late)
      const r = forecastHop({ ...ctx, hop: { ...hop, previewTime: hop.maxFlight } }, late, throwLate.dvx, throwLate.dvy)
      const cost = r.endReason === 'arrived' ? Math.hypot(throwLate.dvx, throwLate.dvy) + captureCost(ctx, r.arrival!.relSpeed) : Infinity
      expect(cost, id).toBeGreaterThan(hop.refCost * 1.3)
    }
  })

  it('the windows chart dips where the reference launches', () => {
    const s = new Session(getMission('m1'))
    const c = s.windowChart()
    const min = Math.min(...c.costs)
    const max = Math.max(...c.costs)
    expect(max / min).toBeGreaterThan(2)
    const i = Math.round((s.mission.hops[0].reference.wait / c.span) * (c.costs.length - 1))
    expect(c.costs[i]).toBeLessThan(min * 1.5)
  })

  it('the clock slows down while the slingshot is held and speeds up on fast forward', () => {
    const s = new Session(getMission('m1'))
    run(s, (x) => x.phaseClock > 1)
    const normal = s.timeScale
    s.aiming = true
    run(s, (x) => x.phaseClock > 2)
    expect(s.timeScale).toBeLessThan(normal * 0.5)
    s.aiming = false
    s.fastForward = true
    run(s, (x) => x.phaseClock > 3)
    expect(s.timeScale).toBeGreaterThan(normal * 3)
  })
})

describe('the tank', () => {
  it('pays for the launch and for a capture faster than the planet’s escape speed; giants catch for free', () => {
    const rubra = playReference(getMission('m1')).events.find((e) => e.kind === 'captured')
    expect(rubra && rubra.kind === 'captured' && rubra.cost).toBeGreaterThan(0)
    const colossus = playReference(getMission('m5')).events.find((e) => e.kind === 'captured')
    expect(colossus && colossus.kind === 'captured' && colossus.cost).toBe(0)
  })

  it('a throw can never take more than is left in the tank', () => {
    const m = getMission('m1')
    const s = new Session({ ...m, fuel: m.power * 0.3 })
    s.setAim(m.power, 0)
    expect(Math.hypot(s.aim!.dvx, s.aim!.dvy)).toBeCloseTo(m.power * 0.3, 12)
  })

  it('arriving too fast for what is left fails the hop: not enough fuel to brake', () => {
    const m = getMission('m1')
    const hop = m.hops[0]
    const launch = Math.hypot(hop.reference.dvx, hop.reference.dvy)
    // enough to launch, not enough to brake at Rubra
    const s = new Session({ ...m, fuel: launch + (hop.refCost - launch) * 0.3 })
    run(s, (x) => x.t >= hop.reference.wait - hop.parkPace / 60)
    s.t = hop.reference.wait
    s.setAim(hop.reference.dvx, hop.reference.dvy)
    expect(s.launch()).toBe(true)
    const events = run(s, (x) => x.phase !== 'flight')
    const fail = events.find((e) => e.kind === 'failed')
    expect(fail && fail.kind === 'failed' && fail.reason).toBe('fuel')
    expect(fail && fail.kind === 'failed' && fail.need).toBeGreaterThan(0)
  })
})

describe('checkpoints', () => {
  it('a failed hop goes back to where the ship parked, with the fuel it had there', () => {
    const m = getMission('m3')
    const { session: ref } = playReference(m)
    expect(ref.phase).toBe('complete')
    const s = new Session(m)
    // fly hop 1 on its window, then throw hop 2 straight into the star
    const h0 = m.hops[0]
    run(s, (x) => x.t >= h0.reference.wait - h0.parkPace / 60)
    s.t = h0.reference.wait
    s.setAim(h0.reference.dvx, h0.reference.dvy)
    s.launch()
    run(s, (x) => x.phase === 'parked' && x.hopIndex === 1)
    const cp = { t: s.checkpoint.t, fuel: s.fuel, spent: s.totalSpent }
    expect(cp.fuel).toBeLessThan(m.fuel)
    const p = bodyState(s.world.system, s.origin, s.t)
    s.setAim(-p.vx * 0.9, -p.vy * 0.9)
    s.launch()
    const events = run(s, (x) => x.phase === 'failed')
    expect(events.some((e) => e.kind === 'failed')).toBe(true)
    run(s, (x) => x.phase === 'parked')
    expect(s.hopIndex).toBe(1)
    expect(s.t).toBeCloseTo(cp.t, 12)
    expect(s.fuel).toBeCloseTo(cp.fuel, 12)
    expect(s.totalSpent).toBeCloseTo(cp.spent, 12)
    expect(s.ghost?.path.length).toBeGreaterThan(4)
    s.restartMission()
    expect(s.hopIndex).toBe(0)
    expect(s.t).toBe(0)
    expect(s.fuel).toBe(m.fuel)
  })

  it('missing the deadline restarts the whole mission', () => {
    const m = getMission('m10')
    expect(m.deadline).not.toBeNull()
    const s = new Session({ ...m, deadline: 0.5 })
    s.fastForward = true
    const events = run(s, (x) => x.phase === 'failed')
    const fail = events.find((e) => e.kind === 'failed')
    expect(fail && fail.kind === 'failed' && fail.reason).toBe('deadline')
    for (let t = 0; t <= FAIL_PAUSE + 0.1; t += 0.05) s.update(0.05)
    expect(s.phase).toBe('parked')
    expect(s.hopIndex).toBe(0)
    expect(s.t).toBeLessThan(0.5)
  })
})

describe('boosts', () => {
  const m = getMission('m6')
  const w = buildWorld(m)
  const ctx = hopContext(m, w, 0)
  const ref = m.hops[0].reference
  const fly = () => new Flight(ctx, ref.wait, { dvx: ref.dvx, dvy: ref.dvy }, m.fuel)

  it('a quick tap still gives the minimum charge, a long press the full one', () => {
    const f = fly()
    expect(f.boostSize(0)).toBeCloseTo(m.boostMax * MIN_CHARGE, 12)
    expect(f.boostSize(5)).toBeCloseTo(m.boostMax, 12)
  })

  it('are deterministic and change the path only from the moment they fire', () => {
    const a = fly()
    const b = fly()
    const t = ref.wait + 1
    const before = { ...a.stateAt(t - 0.2) }
    a.boost(t, 1, 0.3, 0.6)
    b.boost(t, 1, 0.3, 0.6)
    expect(a.stateAt(t - 0.2)).toEqual(before)
    expect(b.end).toEqual(a.end)
    expect(b.flybys()).toEqual(a.flybys())
    expect(a.boostSpent).toBeCloseTo(m.boostMax * 0.6, 12)
  })

  it('a boost inside a giant’s sphere is engine energy, and the closest approach is the one actually flown', () => {
    const ref0 = fly()
    const fb = ref0.flybys().find((x) => w.planetOf[x.bodyIndex] === 'colossus')!
    expect(fb).toBeDefined()
    const f = fly()
    const tBoost = fb.tIn + (fb.tOut - fb.tIn) * 0.15
    const v = f.stateAt(tBoost)
    expect(f.boost(tBoost, -v.vy, v.vx, 1)).toBe(true)
    const recs = f.flybys().filter((x) => x.bodyIndex === fb.bodyIndex && x.tIn < fb.tOut + 0.5)
    expect(recs).toHaveLength(1)
    expect(recs[0].tIn).toBeCloseTo(fb.tIn, 9)
    expect(recs[0].burnEnergy).not.toBe(0)
    let flown = Infinity
    for (let t = recs[0].tIn; t <= Math.min(recs[0].tOut, f.end.t); t += 0.0005) {
      const s = f.stateAt(t)
      const p = bodyState(w.system, fb.bodyIndex, t)
      flown = Math.min(flown, Math.hypot(s.x - p.x, s.y - p.y))
    }
    expect(Math.abs(recs[0].distance - flown)).toBeLessThan(2e-3)
  })

  it('a boost right after the launch keeps the departure rules; later the origin is solid again', () => {
    const f = fly()
    expect(f.boost(ref.wait + 0.001, 1, 0, 0)).toBe(true)
    expect(f.segments[1].departing).toBe(true)
    const g = fly()
    const limit = departureRadius(w.system.bodies[ctx.origin])
    let tFar = ref.wait
    for (let t = ref.wait; t < g.end.t; t += 0.01) {
      const s = g.stateAt(t)
      const p = bodyState(w.system, ctx.origin, t)
      if (Math.hypot(s.x - p.x, s.y - p.y) > limit * 2) {
        tFar = t
        break
      }
    }
    expect(g.boost(tFar, 0, 1, 0)).toBe(true)
    expect(g.segments[1].departing).toBe(false)
  })

  it('the origin planet does not pull a ship leaving its parking orbit', () => {
    const st = launchState(w, ctx.origin, 1, 0, 0)
    const p = bodyState(w.system, ctx.origin, 1)
    expect(st).toEqual(p)
    expect(w.systemFrom(ctx.origin).bodies[ctx.origin].mu).toBe(0)
    expect(w.system.bodies[ctx.origin].mu).toBeGreaterThan(0)
  })
})

describe('progress', () => {
  it('opens missions one by one and chapters by stars', () => {
    let save = emptySave()
    expect(missionOpen(save, 'm1')).toBe(true)
    expect(missionOpen(save, 'm2')).toBe(false)
    save = withResult(save, 'm1', 1, 0.3).save
    expect(missionOpen(save, 'm2')).toBe(true)
    for (const id of ['m2', 'm3', 'm4']) save = withResult(save, id, 1, 0.3).save
    expect(totalStars(save)).toBe(4)
    expect(missionOpen(save, 'm5')).toBe(false)
    save = withResult(save, 'm4', 3, 0.3).save
    expect(totalStars(save)).toBe(6)
    expect(missionOpen(save, 'm5')).toBe(true)
    expect(missionOpen(emptySave(), 'm12', true)).toBe(true)
  })

  it('keeps the best stars and the least fuel spent', () => {
    let r = withResult(emptySave(), 'm1', 2, 0.25)
    expect(r.newBest).toBe(false)
    expect(r.newStars).toBe(2)
    r = withResult(r.save, 'm1', 1, 0.2)
    expect(r.save.missions.m1).toEqual({ done: true, stars: 2, bestSpent: 0.2 })
    expect(r.newBest).toBe(true)
    expect(r.newStars).toBe(0)
  })
})
