import { describe, expect, it } from 'vitest'
import { CASUAL_LEVELS, CHAPTERS, getCasualLevel } from '../src/game/casual/levels'
import { emptySave, levelOpen, totalStars, withResult } from '../src/game/casual/progress'
import { scoreFlight, slingshotGain } from '../src/game/casual/scoring'
import { FAIL_PAUSE, Session, type GameEvent } from '../src/game/casual/session'
import { Flight, MIN_CHARGE } from '../src/game/casual/sim'
import { bodyState } from '../src/game/physics/system'

/** Plays a session in fixed real-time steps until it stops flying. */
function play(s: Session, onFrame?: (s: Session) => void): GameEvent[] {
  const events: GameEvent[] = []
  for (let i = 0; i < 20000 && s.phase === 'flight'; i++) {
    s.update(1 / 60)
    events.push(...s.drain())
    onFrame?.(s)
  }
  return events
}

describe('casual levels', () => {
  it('are numbered in order, grouped into the declared chapters', () => {
    expect(CASUAL_LEVELS.length).toBeGreaterThanOrEqual(12)
    CASUAL_LEVELS.forEach((l, i) => {
      expect(l.number).toBe(i + 1)
      expect(CHAPTERS.some((c) => c.number === l.chapter)).toBe(true)
      expect(l.stardust).toHaveLength(3)
      expect(l.previewTime).toBeGreaterThan(0)
      expect(l.previewTime).toBeLessThanOrEqual(l.refTime + 1e-9)
      expect(l.horizon).toBeGreaterThan(l.refTime)
      expect(l.fuel).toBeGreaterThanOrEqual(0)
    })
    expect(new Set(CASUAL_LEVELS.map((l) => l.id)).size).toBe(CASUAL_LEVELS.length)
    const chapters = CASUAL_LEVELS.map((l) => l.chapter)
    expect([...chapters].sort((a, b) => a - b)).toEqual(chapters)
  })

  it.each(CASUAL_LEVELS.map((l) => [l.id, l.title] as const))('%s %s: the reference throw arrives with all three stardust', (id) => {
    const level = getCasualLevel(id)
    const { dvx, dvy } = level.reference
    expect(Math.hypot(dvx, dvy)).toBeLessThanOrEqual(level.power)
    const flight = new Flight(level, level.reference).runToEnd()
    expect(flight.end.reason).toBe('arrived')
    expect(flight.end.t).toBeCloseTo(level.refTime, 2)
    expect(flight.collected).toEqual([true, true, true])
    expect(scoreFlight(flight).stars).toBe(3)
  })

  it('gravity-assist chapters really are about slingshots', () => {
    for (const level of CASUAL_LEVELS.filter((l) => l.chapter >= 2)) {
      const flight = new Flight(level, level.reference).runToEnd()
      expect(scoreFlight(flight).slingshots, level.id).toBeGreaterThanOrEqual(1)
    }
  })
})

describe('boosts', () => {
  const level = getCasualLevel('c5')

  it('a quick tap still gives the minimum charge, a long press the full one', () => {
    const f = new Flight(level, level.reference)
    expect(f.boostSize(0)).toBeCloseTo(level.boostMax * MIN_CHARGE, 12)
    expect(f.boostSize(5)).toBeCloseTo(level.boostMax, 12)
  })

  it('spend fuel and stop when the tank is empty', () => {
    const f = new Flight(level, level.reference)
    let fired = 0
    for (let k = 0; k < 10; k++) if (f.boost(0.3 + k * 0.05, 0, 1, 1)) fired++
    expect(fired).toBe(Math.ceil(level.fuel / level.boostMax - 1e-9))
    expect(f.fuelLeft).toBeCloseTo(0, 12)
    const used = f.boostsUsed.reduce((s, b) => s + Math.hypot(b.dvx, b.dvy), 0)
    expect(used).toBeCloseTo(level.fuel, 12)
  })

  it('are deterministic: the same presses give the same flight', () => {
    const fly = () => {
      const f = new Flight(level, level.reference)
      f.boost(0.8, 1, 0.3, 0.6)
      f.boost(1.9, -0.2, 1, 0.3)
      return f.runToEnd()
    }
    const a = fly()
    const b = fly()
    expect(b.end).toEqual(a.end)
    expect(b.collected).toEqual(a.collected)
    expect(b.flybys()).toEqual(a.flybys())
  })

  it('change the path from the moment they fire, not before', () => {
    const f = new Flight(level, level.reference)
    const before = { ...f.stateAt(1) }
    f.boost(1.5, 1, 0, 1)
    expect(f.stateAt(1)).toEqual(before)
    const s = f.stateAt(1.5)
    const ref = new Flight(level, level.reference).stateAt(1.5)
    expect(Math.hypot(s.vx - ref.vx, s.vy - ref.vy)).toBeCloseTo(level.boostMax, 9)
  })

  it('fired inside a giant’s sphere do not count as gravity gain', () => {
    const ref = new Flight(level, level.reference)
    const fb = ref.flybys().find((x) => ref.world.planetOf[x.bodyIndex] === 'colossus')!
    expect(fb).toBeDefined()
    const mid = (fb.tIn + fb.t) / 2
    const f = new Flight(level, level.reference)
    expect(f.boost(mid, 0, 1, 0.5)).toBe(true)
    const recs = f.flybys().filter((x) => x.bodyIndex === fb.bodyIndex && x.tIn < fb.tOut + 0.5)
    // one encounter, not two halves
    expect(recs).toHaveLength(1)
    expect(recs[0].tIn).toBeCloseTo(fb.tIn, 9)
    expect(recs[0].burnEnergy).not.toBe(0)
    // the boost's own energy is excluded: the planet's share stays a few km/s, as in the clean flyby
    expect(Math.abs(slingshotGain(recs[0]) - slingshotGain(fb))).toBeLessThan(3)
  })
})

describe('scoring', () => {
  it('adds up its lines; stars only when the ship arrives', () => {
    const level = getCasualLevel('c5')
    const win = scoreFlight(new Flight(level, level.reference).runToEnd())
    expect(win.arrived).toBe(true)
    expect(win.total).toBe(win.lines.reduce((s, l) => s + l.points, 0))
    expect(win.lines.some((l) => l.label.startsWith('Праща у Колосса'))).toBe(true)
    expect(win.lines.some((l) => l.label.startsWith('Топливо в запасе'))).toBe(true)

    const miss = new Flight(level, { dvx: level.reference.dvx * 0.5, dvy: level.reference.dvy * 0.5 }).runToEnd()
    const lost = scoreFlight(miss)
    expect(lost.arrived).toBe(false)
    expect(lost.stars).toBe(0)
    expect(lost.total).toBe(0)
  })
})

describe('session', () => {
  it('plays the reference throw: launch, all stardust, a slingshot, arrival', () => {
    const s = new Session(getCasualLevel('c5'))
    s.setAim(s.level.reference.dvx, s.level.reference.dvy)
    expect(s.launch()).toBe(true)
    const events = [...s.drain(), ...play(s)]
    const kinds = events.map((e) => e.kind)
    expect(kinds[0]).toBe('launch')
    expect(kinds.filter((k) => k === 'dust')).toHaveLength(3)
    expect(kinds).toContain('flybyIn')
    expect(kinds).toContain('slingshot')
    expect(kinds[kinds.length - 1]).toBe('arrived')
    expect(s.phase).toBe('arrived')
    expect(s.score?.stars).toBe(3)
    const sling = events.find((e) => e.kind === 'slingshot')
    expect(sling && sling.kind === 'slingshot' && sling.gainKms).toBeGreaterThan(5)
  })

  it('slows time down while a giant swings the ship', () => {
    const s = new Session(getCasualLevel('c5'))
    s.setAim(s.level.reference.dvx, s.level.reference.dvy)
    s.launch()
    const giant = s.world.planetOf.indexOf('colossus')
    const infR = s.world.system.bodies[giant].influenceRadius
    let inside = Infinity
    let cruise = 0
    play(s, (x) => {
      const ship = x.ship()!
      const p = bodyState(x.world.system, giant, x.t)
      const d = Math.hypot(ship.x - p.x, ship.y - p.y)
      if (d < infR * 0.4) inside = Math.min(inside, x.timeScale)
      if (d > infR * 2 && x.phaseClock > 1) cruise = Math.max(cruise, x.timeScale)
    })
    expect(inside).toBeLessThan(cruise * 0.5)
  })

  it('a failed attempt becomes the ghost and the next aim starts by itself', () => {
    const s = new Session(getCasualLevel('c5'))
    s.setAim(-s.level.reference.dvx, -s.level.reference.dvy)
    s.launch()
    const events = play(s)
    expect(s.phase).toBe('failed')
    expect(events.some((e) => e.kind === 'failed')).toBe(true)
    for (let t = 0; t <= FAIL_PAUSE + 0.1; t += 0.05) s.update(0.05)
    expect(s.phase).toBe('aim')
    expect(s.ghost?.path.length).toBeGreaterThan(10)
    expect(s.ghost?.launch.dvx).toBeCloseTo(-s.level.reference.dvx, 12)
  })

  it('ignores a pull too weak to be a throw', () => {
    const s = new Session(getCasualLevel('c1'))
    s.setAim(s.level.power * 0.01, 0)
    expect(s.launch()).toBe(false)
    expect(s.phase).toBe('aim')
  })

  it('caps the pull at the level power', () => {
    const s = new Session(getCasualLevel('c1'))
    s.setAim(s.level.power * 3, 0)
    expect(Math.hypot(s.aim!.dvx, s.aim!.dvy)).toBeCloseTo(s.level.power, 12)
  })

  it('charges a boost with real time and slows the clock while charging', () => {
    const s = new Session(getCasualLevel('c5'))
    s.setAim(s.level.reference.dvx, s.level.reference.dvy)
    s.launch()
    for (let i = 0; i < 60; i++) s.update(1 / 60)
    const cruise = s.timeScale
    expect(s.startCharge(1, 0)).toBe(true)
    for (let i = 0; i < 30; i++) s.update(1 / 60)
    expect(s.chargeLevel).toBeCloseTo(0.5 / 0.75, 2)
    expect(s.timeScale).toBeLessThan(cruise * 0.4)
    expect(s.chargePreview()).not.toBeNull()
    expect(s.releaseCharge()).toBe(true)
    expect(s.drain().some((e) => e.kind === 'boost')).toBe(true)
    expect(s.flight!.fuelLeft).toBeLessThan(s.level.fuel)
  })
})

describe('progress', () => {
  it('opens levels one by one and chapters by stars', () => {
    let save = emptySave()
    expect(levelOpen(save, 'c1')).toBe(true)
    expect(levelOpen(save, 'c2')).toBe(false)
    save = withResult(save, 'c1', 1, 1500).save
    expect(levelOpen(save, 'c2')).toBe(true)
    for (const id of ['c2', 'c3', 'c4']) save = withResult(save, id, 1, 1500).save
    // chapter 2 needs 6 stars: four levels with one star each are not enough
    expect(totalStars(save)).toBe(4)
    expect(levelOpen(save, 'c5')).toBe(false)
    save = withResult(save, 'c4', 3, 2500).save
    expect(totalStars(save)).toBe(6)
    expect(levelOpen(save, 'c5')).toBe(true)
    expect(levelOpen(emptySave(), 'c12', true)).toBe(true)
  })

  it('keeps the best stars and score', () => {
    let r = withResult(emptySave(), 'c1', 3, 2500)
    expect(r.newBest).toBe(false)
    expect(r.newStars).toBe(3)
    r = withResult(r.save, 'c1', 1, 3000)
    expect(r.save.levels.c1).toEqual({ done: true, stars: 3, best: 3000 })
    expect(r.newBest).toBe(true)
    expect(r.newStars).toBe(0)
  })
})
