import type { FlybyRecord } from '../physics/propagate'
import { toKms } from '../physics/units'
import type { Mission } from './types'

/** Heliocentric speed the planet's gravity alone added (+) or took (−), measured at the entry distance, km/s. */
export function slingshotGain(fb: FlybyRecord): number {
  const v2 = fb.speedIn * fb.speedIn + 2 * (fb.energyOut - fb.energyIn - fb.burnEnergy)
  return toKms(Math.sqrt(Math.max(0, v2)) - fb.speedIn)
}

/** A flyby counts as a slingshot when it changed the speed noticeably. */
export const SLINGSHOT_MIN_KMS = 1

/** "Впритирку": periapsis within this many planet radii. */
export const CLOSE_PASS_RADII = 1.7

/** Stars for a finished mission by the total Δv spent (launches, captures, boosts). */
export function starsFor(mission: Mission, spent: number): number {
  if (spent <= mission.stars[0] + 1e-9) return 3
  if (spent <= mission.stars[1] + 1e-9) return 2
  return 1
}

/** Δv spent per kind, summed over the hops flown. */
export interface Spending {
  launch: number
  capture: number
  boost: number
}

export const totalSpent = (s: Spending): number => s.launch + s.capture + s.boost
