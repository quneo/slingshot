import { CATALOG, type BodyId } from '../levels/catalog'

export interface Assets {
  planets: Record<BodyId, HTMLImageElement>
  starGlow: HTMLImageElement
  rings: HTMLImageElement
  ship: HTMLImageElement
  asteroids: HTMLImageElement[]
  background: HTMLImageElement
}

const base = import.meta.env.BASE_URL

function load(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.decoding = 'async'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`Failed to load ${src}`))
    img.src = `${base}assets/${src}`
  })
}

let cache: Promise<Assets> | null = null

export function loadAssets(): Promise<Assets> {
  if (cache) return cache
  const ids = Object.keys(CATALOG) as BodyId[]
  cache = (async () => {
    const [planetImgs, starGlow, rings, ship, background, ...asteroids] = await Promise.all([
      Promise.all(ids.map((id) => load(`${CATALOG[id].visual.sprite}.webp`))),
      load('star-glow.webp'),
      load('rings.webp'),
      load('ship.webp'),
      load('bg-nebula.jpg'),
      ...Array.from({ length: 8 }, (_, i) => load(`asteroid-${i}.webp`)),
    ])
    const planets = Object.fromEntries(ids.map((id, i) => [id, planetImgs[i]])) as Record<BodyId, HTMLImageElement>
    return { planets, starGlow, rings, ship, asteroids, background }
  })()
  return cache
}

/** URL of a planet sprite, for HTML thumbnails. */
export const planetSpriteUrl = (id: BodyId): string => `${base}assets/${CATALOG[id].visual.sprite}.webp`
