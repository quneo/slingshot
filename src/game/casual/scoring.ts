import { genitiveOf } from '../levels/names'
import type { FlybyRecord } from '../physics/propagate'
import { toKms } from '../physics/units'
import type { Flight } from './sim'

/** Heliocentric speed the planet's gravity alone added (+) or took (−), measured at the entry distance, km/s. */
export function slingshotGain(fb: FlybyRecord): number {
  const v2 = fb.speedIn * fb.speedIn + 2 * (fb.energyOut - fb.energyIn - fb.burnEnergy)
  return toKms(Math.sqrt(Math.max(0, v2)) - fb.speedIn)
}

/** A flyby counts as a slingshot when it changed the speed noticeably. */
export const SLINGSHOT_MIN_KMS = 1

export interface ScoreLine {
  label: string
  points: number
}

export interface FlightScore {
  arrived: boolean
  stars: number
  stardust: number
  total: number
  lines: ScoreLine[]
  slingshots: number
}

export const POINTS = {
  arrival: 1000,
  stardust: 500,
  /** per km/s the planet added or took: the slingshot is the hero of the score */
  perKms: 100,
  closePass: 500,
  /** for a full tank left at arrival */
  fuelLeft: 600,
} as const

/** "Впритирку": periapsis within this many planet radii. */
export const CLOSE_PASS_RADII = 1.7

export function isClosePass(flight: Flight, fb: FlybyRecord): boolean {
  const body = flight.world.system.bodies[fb.bodyIndex]
  return fb.distance < body.radius * CLOSE_PASS_RADII
}

/** Score of a finished flight. Stars = stardust collected, and only when the ship arrived. */
export function scoreFlight(flight: Flight): FlightScore {
  const arrived = flight.end.reason === 'arrived'
  const stardust = flight.collected.filter(Boolean).length
  const lines: ScoreLine[] = []
  if (arrived) lines.push({ label: 'Цель достигнута', points: POINTS.arrival })
  if (stardust > 0) lines.push({ label: `Звёздная пыль ×${stardust}`, points: stardust * POINTS.stardust })
  let slingshots = 0
  for (const fb of flight.flybys()) {
    if (fb.bodyIndex === flight.world.targetIndex) continue
    const gain = slingshotGain(fb)
    if (Math.abs(gain) < SLINGSHOT_MIN_KMS) continue
    slingshots++
    const combo = slingshots // 1×, 2×, 3× …
    const name = genitiveOf(flight.world.planetOf[fb.bodyIndex] ?? 'lyra')
    lines.push({ label: `Праща у ${name}${combo > 1 ? `, комбо ×${combo}` : ''}`, points: Math.round(Math.abs(gain) * POINTS.perKms * combo) })
    if (isClosePass(flight, fb)) lines.push({ label: 'Впритирку!', points: POINTS.closePass })
  }
  if (arrived && flight.level.fuel > 0 && flight.fuelLeft > 1e-9) {
    const share = flight.fuelLeft / flight.level.fuel
    lines.push({ label: `Топливо в запасе: ${Math.round(share * 100)}%`, points: Math.round(share * POINTS.fuelLeft) })
  }
  const total = lines.reduce((s, l) => s + l.points, 0)
  return { arrived, stars: arrived ? stardust : 0, stardust, total: arrived ? total : 0, lines, slingshots }
}
