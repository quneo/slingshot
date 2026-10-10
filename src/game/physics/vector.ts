export interface Vec2 {
  x: number
  y: number
}

export const vec = (x: number, y: number): Vec2 => ({ x, y })
export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y })
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y })
export const scale = (a: Vec2, k: number): Vec2 => ({ x: a.x * k, y: a.y * k })
export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y
export const cross = (a: Vec2, b: Vec2): number => a.x * b.y - a.y * b.x
export const length = (a: Vec2): number => Math.hypot(a.x, a.y)
export const distance = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y)

export function normalize(a: Vec2, fallback: Vec2 = { x: 1, y: 0 }): Vec2 {
  const len = Math.hypot(a.x, a.y)
  return len > 1e-15 ? { x: a.x / len, y: a.y / len } : { ...fallback }
}

/** Rotates 90° clockwise. For a prograde (counter-clockwise) orbit this points away from the star. */
export const perpRight = (a: Vec2): Vec2 => ({ x: a.y, y: -a.x })

export const angleOf = (a: Vec2): number => Math.atan2(a.y, a.x)
export const fromAngle = (angle: number, len = 1): Vec2 => ({ x: Math.cos(angle) * len, y: Math.sin(angle) * len })
