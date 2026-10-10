import { toDays, toKms, toMillionKm } from '../game/physics/units'

const nf = (digits: number, min = 0) =>
  new Intl.NumberFormat('ru-RU', { maximumFractionDigits: digits, minimumFractionDigits: min })

export function plural(n: number, one: string, few: string, many: string): string {
  const a = Math.abs(n) % 100
  const b = a % 10
  if (a > 10 && a < 20) return many
  if (b > 1 && b < 5) return few
  if (b === 1) return one
  return many
}

/** model speed → "3,7 км/с" */
export const kms = (v: number, digits = 1): string => `${nf(digits, digits).format(toKms(v))} км/с`
export const kmsNumber = (v: number, digits = 1): string => nf(digits, digits).format(toKms(v))

/** model time → whole days */
export const days = (t: number): number => Math.round(toDays(t))
export const daysLabel = (t: number): string => {
  const d = days(t)
  return `${d} ${plural(d, 'день', 'дня', 'дней')}`
}

export const mkm = (d: number): string => {
  const v = toMillionKm(d)
  return `${nf(v < 10 ? 1 : 0).format(v)} млн км`
}

export const degrees = (rad: number): string => `${Math.round((rad * 180) / Math.PI)}°`
