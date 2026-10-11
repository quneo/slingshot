/** Particles, floating captions, camera shake and flashes. Positions are in world units, sizes in CSS px. */

export interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  age: number
  life: number
  size: number
  color: string
  /** velocity kept per second (0…1) */
  drag: number
  /** additive blending: sparks and glows */
  glow: boolean
}

export interface Popup {
  x: number
  y: number
  text: string
  sub: string | null
  color: string
  size: number
  age: number
  life: number
}

export interface BurstOptions {
  count: number
  /** CSS px per second at the moment of the burst */
  speed: number
  colors: string[]
  size: number
  life: number
  /** emit into a cone around this world direction (radians), otherwise all around */
  dir?: number
  spread?: number
  drag?: number
  glow?: boolean
}

export class Fx {
  particles: Particle[] = []
  popups: Popup[] = []
  /** px, decays */
  shake = 0
  flash = 0
  flashColor = '255, 210, 122'
  private seed = 987654

  private rnd(): number {
    this.seed = (this.seed * 16807) % 2147483647
    return (this.seed - 1) / 2147483646
  }

  /** `zoom` converts the px speeds into world units at the current camera. */
  burst(x: number, y: number, zoom: number, o: BurstOptions): void {
    for (let i = 0; i < o.count; i++) {
      const a = o.dir !== undefined ? o.dir + (this.rnd() - 0.5) * (o.spread ?? 1) : this.rnd() * Math.PI * 2
      const v = (o.speed * (0.35 + 0.65 * this.rnd())) / zoom
      this.particles.push({
        x, y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        age: 0,
        life: o.life * (0.6 + 0.6 * this.rnd()),
        size: o.size * (0.5 + this.rnd()),
        color: o.colors[Math.floor(this.rnd() * o.colors.length)],
        drag: o.drag ?? 0.15,
        glow: o.glow ?? true,
      })
    }
    if (this.particles.length > 900) this.particles.splice(0, this.particles.length - 900)
  }

  /** A caption over a world point; `delay` (s) lets a second caption follow the first instead of covering it. */
  popup(x: number, y: number, text: string, color: string, sub: string | null = null, size = 26, life = 1.6, delay = 0): void {
    this.popups.push({ x, y, text, sub, color, size, age: -delay, life })
  }

  kick(px: number): void {
    this.shake = Math.max(this.shake, px)
  }

  flashOnce(strength: number, rgb = '255, 210, 122'): void {
    this.flash = Math.max(this.flash, strength)
    this.flashColor = rgb
  }

  clear(): void {
    this.particles = []
    this.popups = []
    this.shake = 0
    this.flash = 0
  }

  update(dt: number): void {
    for (const p of this.particles) {
      p.age += dt
      const k = Math.pow(p.drag, dt)
      p.vx *= k
      p.vy *= k
      p.x += p.vx * dt
      p.y += p.vy * dt
    }
    this.particles = this.particles.filter((p) => p.age < p.life)
    for (const p of this.popups) p.age += dt
    this.popups = this.popups.filter((p) => p.age < p.life)
    this.shake *= Math.exp(-dt * 9)
    if (this.shake < 0.2) this.shake = 0
    this.flash *= Math.exp(-dt * 3.5)
    if (this.flash < 0.01) this.flash = 0
  }

  /** Random offset for this frame's camera shake. */
  shakeOffset(): { x: number; y: number } {
    if (!this.shake) return { x: 0, y: 0 }
    return { x: (this.rnd() - 0.5) * 2 * this.shake, y: (this.rnd() - 0.5) * 2 * this.shake }
  }
}
