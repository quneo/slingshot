/**
 * Model units. The simulation runs in dimensionless units with G = 1:
 *   length  L0 = 1.5e8 km          (one "ед. расстояния", ≈ 1 AU — a fictional system, not the Solar System)
 *   mass    M0 = mass of the star  (star μ = G·M0 = 1; a star of one solar mass)
 *   time    T0 = sqrt(L0³ / (G·M0)) ≈ 58.4 days
 *   speed   V0 = L0 / T0           ≈ 29.7 km/s
 * Every number the UI shows is converted from model units by these factors and nothing else.
 */
export const LENGTH_UNIT_KM = 1.5e8
export const STAR_GM_KM3_S2 = 1.32712440018e11

export const TIME_UNIT_S = Math.sqrt(LENGTH_UNIT_KM ** 3 / STAR_GM_KM3_S2)
export const DAYS_PER_TIME_UNIT = TIME_UNIT_S / 86_400
export const KMS_PER_SPEED_UNIT = LENGTH_UNIT_KM / TIME_UNIT_S

export const toDays = (t: number): number => t * DAYS_PER_TIME_UNIT
export const fromDays = (days: number): number => days / DAYS_PER_TIME_UNIT
export const toKms = (v: number): number => v * KMS_PER_SPEED_UNIT
export const fromKms = (kms: number): number => kms / KMS_PER_SPEED_UNIT
/** Millions of kilometres, used for distances in the HUD. */
export const toMillionKm = (d: number): number => (d * LENGTH_UNIT_KM) / 1e6
