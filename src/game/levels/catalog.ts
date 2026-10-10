/**
 * The fictional training system «Лира». Values are in model units (see physics/units.ts).
 * Radii are physical collision radii of this made-up system, not the Solar System.
 */

export type BodyId = 'lyra' | 'cinder' | 'aqua' | 'rubra' | 'colossus' | 'aurum' | 'borey' | 'viola'

export interface BodyVisual {
  sprite: string
  /** base hue for orbit lines, labels, glows */
  color: string
  rings?: boolean
  /** render radius ÷ physical radius when "enlarged planets" is on */
  enlarge: number
}

export interface CatalogBody {
  id: BodyId
  name: string
  /** short description for tooltips / mission cards */
  blurb: string
  mu: number
  radius: number
  /** circular orbit radius around the star; null for the star itself */
  orbitRadius: number | null
  visual: BodyVisual
}

export const STAR_MU = 1

export const CATALOG: Record<BodyId, CatalogBody> = {
  lyra: {
    id: 'lyra',
    name: 'Лира',
    blurb: 'Звезда системы. Слишком близко — сгорите.',
    mu: STAR_MU,
    radius: 0.09,
    orbitRadius: null,
    visual: { sprite: 'star-surface', color: '#FFB64D', enlarge: 1.6 },
  },
  cinder: {
    id: 'cinder',
    name: 'Пепел',
    blurb: 'Маленькая каменная планета у самой звезды.',
    mu: 2e-5,
    radius: 0.03,
    orbitRadius: 0.55,
    visual: { sprite: 'planet-moon', color: '#A9B4C6', enlarge: 1.8 },
  },
  aqua: {
    id: 'aqua',
    name: 'Аква',
    blurb: 'Океанский мир. Здесь стоит ваша стартовая станция.',
    mu: 6e-5,
    radius: 0.05,
    orbitRadius: 1.0,
    visual: { sprite: 'planet-aqua', color: '#4DCFF5', enlarge: 1.8 },
  },
  rubra: {
    id: 'rubra',
    name: 'Рубра',
    blurb: 'Пыльная красная планета. Лёгкая — почти не притягивает.',
    mu: 4e-5,
    radius: 0.045,
    orbitRadius: 1.6,
    visual: { sprite: 'planet-rubra', color: '#F08A5D', enlarge: 1.8 },
  },
  colossus: {
    id: 'colossus',
    name: 'Колосс',
    blurb: 'Газовый гигант. Его гравитация разгоняет и тормозит корабли.',
    mu: 0.01,
    radius: 0.13,
    orbitRadius: 2.6,
    visual: { sprite: 'planet-colossus', color: '#FFB64D', enlarge: 1.5 },
  },
  aurum: {
    id: 'aurum',
    name: 'Аурум',
    blurb: 'Окольцованный гигант. Кольца не опасны, опасна сама планета.',
    mu: 0.004,
    radius: 0.1,
    orbitRadius: 4.0,
    visual: { sprite: 'planet-aurum', color: '#F3D58B', rings: true, enlarge: 1.5 },
  },
  borey: {
    id: 'borey',
    name: 'Борей',
    blurb: 'Ледяной гигант на окраине системы.',
    mu: 0.0025,
    radius: 0.085,
    orbitRadius: 5.6,
    visual: { sprite: 'planet-borey', color: '#7FE3F0', enlarge: 1.6 },
  },
  viola: {
    id: 'viola',
    name: 'Виола',
    blurb: 'Далёкий фиолетовый мир за орбитой Борея.',
    mu: 0.0008,
    radius: 0.07,
    orbitRadius: 7.2,
    visual: { sprite: 'planet-viola', color: '#B79CFF', enlarge: 1.7 },
  },
}

/** Radius inside which a pass counts as a gravity-assist flyby: the Laplace sphere of influence, at least 3 radii. */
export function influenceRadius(body: CatalogBody): number {
  if (body.orbitRadius === null) return 0
  return Math.max(body.orbitRadius * Math.pow(body.mu / STAR_MU, 0.4), body.radius * 3)
}
