import { CATALOG, type BodyId, type CatalogBody } from '../../levels/catalog'
import { newSample, sampleTrajectory } from '../../physics/interpolate'
import type { PropagationResult } from '../../physics/propagate'
import { bodyState } from '../../physics/system'
import type { Assets } from '../../rendering/assets'
import { Camera } from '../../rendering/camera'
import { arrowHead, drawPlanetDisc, drawRingedPlanet, drawShip, drawStar, haloText, setFont, type Ctx } from '../../rendering/draw'
import { COLORS, withAlpha } from '../../rendering/palette'
import type { Session } from '../session'
import { STARDUST_RADIUS } from '../sim'
import { Fx } from './fx'

export const DISPLAY_FONT = '"Unbounded", "Manrope Variable", system-ui, sans-serif'
const GIANT_MU = 1e-3

interface Star {
  x: number
  y: number
  r: number
  a: number
  tw: number
}

interface BodyView {
  i: number
  id: BodyId
  c: CatalogBody
  wx: number
  wy: number
  x: number
  y: number
  /** drawn radius, px */
  r: number
  giant: boolean
  /** influence radius, px */
  well: number
}

/** What the input layer knows and the picture needs. */
export interface InputView {
  /** current pull in screen px (relative to the press point), while aiming */
  pull: { x: number; y: number } | null
  /** mouse position for the boost hint (null on touch) */
  hover: { x: number; y: number } | null
  /** px of pull that gives full power */
  maxPull: number
  showHint: boolean
  /** first launch on this level: animate the "pull back" gesture */
  teach: boolean
}

const smooth = (a: number, b: number, x: number) => {
  const k = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return k * k * (3 - 2 * k)
}
const lerp = (a: number, b: number, k: number) => a + (b - a) * k

/** Power of the pull (0…1) as a colour: calm cyan → amber → hot red. */
export function powerColor(p: number): string {
  const stops: [number, number, number][] = [
    [77, 207, 245],
    [255, 182, 77],
    [244, 119, 119],
  ]
  const x = Math.min(1, Math.max(0, p)) * 2
  const i = Math.min(1, Math.floor(x))
  const k = x - i
  const a = stops[i]
  const b = stops[i + 1]
  return `rgb(${Math.round(lerp(a[0], b[0], k))}, ${Math.round(lerp(a[1], b[1], k))}, ${Math.round(lerp(a[2], b[2], k))})`
}

export class CasualRenderer {
  readonly camera = new Camera()
  readonly fx = new Fx()
  /** where the ship is on screen (input aims boosts from here) */
  shipX = 0
  shipY = 0
  private readonly ctx: Ctx
  private dpr = 1
  private stars: Star[] = []
  private readonly tmp = newSample()
  /** model time the planets are drawn at: follows the flight, rewinds to 0 for the next aim */
  private shownT = 0
  private lastBoostAt = -10
  private arrival: { attempt: number; angle: number; dir: number } | null = null

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly assets: Assets,
  ) {
    const ctx = canvas.getContext('2d', { alpha: false })
    if (!ctx) throw new Error('Canvas 2D is not available')
    this.ctx = ctx
  }

  resize(width: number, height: number, dpr: number): void {
    this.dpr = Math.min(dpr, 2)
    this.canvas.width = Math.round(width * this.dpr)
    this.canvas.height = Math.round(height * this.dpr)
    this.canvas.style.width = `${width}px`
    this.canvas.style.height = `${height}px`
    this.camera.resize(width, height)
    let seed = 1234567
    const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646
    this.stars = Array.from({ length: Math.round((width * height) / 4800) }, () => ({
      x: rnd() * width,
      y: rnd() * height,
      r: rnd() < 0.92 ? 0.5 + rnd() * 0.7 : 1.2 + rnd() * 0.9,
      a: 0.25 + rnd() * 0.6,
      tw: rnd() < 0.15 ? 0.5 + rnd() * 2 : 0,
    }))
  }

  noteBoost(now: number): void {
    this.lastBoostAt = now
  }

  /** The view the camera should head to this frame. */
  private frameCamera(s: Session, menu: boolean): void {
    const L = s.level
    let cx = L.view.x
    let cy = L.view.y
    let r = L.view.radius * (menu ? 1.04 : 1)
    let rate = 3.5
    const ship = s.phase !== 'aim' ? s.ship(this.tmp) : null
    if (ship && !menu) {
      rate = 2.2
      // keep the ship in the frame
      const d = Math.hypot(ship.x - cx, ship.y - cy)
      const margin = r * 0.14
      if (d + margin > r) {
        const nr = (r + d + margin) / 2
        const k = (nr - r) / d
        cx += (ship.x - cx) * k
        cy += (ship.y - cy) * k
        r = nr
      }
      // lean in on a giant while it swings the ship
      const sys = s.world.system
      let w = 0
      let fx = 0
      let fy = 0
      let fr = 0
      for (let i = 1; i < s.world.firstRock; i++) {
        const b = sys.bodies[i]
        if (b.mu < GIANT_MU || i === s.world.targetIndex) continue
        const p = bodyState(sys, i, s.t)
        const dist = Math.hypot(ship.x - p.x, ship.y - p.y)
        const wi = 1 - smooth(0.8, 1.7, dist / b.influenceRadius)
        if (wi > w) {
          w = wi
          fx = p.x * 0.55 + ship.x * 0.45
          fy = p.y * 0.55 + ship.y * 0.45
          fr = Math.max(b.influenceRadius * 1.2, dist * 1.3)
        }
      }
      if (s.phase === 'arrived') {
        const p = bodyState(sys, s.world.targetIndex, s.t)
        w = 0.9 * smooth(0, 1.3, s.phaseClock)
        fx = p.x
        fy = p.y
        fr = Math.max(0.7, L.target.zoneRadius * 4.5)
      }
      if (w > 0 && fr < r) {
        const k = w * 0.75
        cx = lerp(cx, fx, k)
        cy = lerp(cy, fy, k)
        r = Math.exp(lerp(Math.log(r), Math.log(fr), k))
      }
    }
    this.camera.animateTo(this.camera.fitView(cx, cy, r), rate)
  }

  render(s: Session, input: InputView, now: number, dt: number, menu: boolean): void {
    const ctx = this.ctx
    this.fx.update(dt)
    this.frameCamera(s, menu)
    this.camera.update(dt)
    this.shownT = s.phase === 'aim' ? this.shownT * Math.exp(-dt * 7) : s.t
    if (s.phase === 'aim' && this.shownT < 1e-4) this.shownT = 0

    const shake = this.fx.shakeOffset()
    ctx.setTransform(this.dpr, 0, 0, this.dpr, shake.x * this.dpr, shake.y * this.dpr)
    this.drawBackground(now)
    const bodies = this.bodyViews(s)
    this.drawOrbits(s, bodies)
    this.drawWells(s, bodies, now)
    if (!menu && s.ghost) this.drawPolyline(s.ghost.path, withAlpha(COLORS.text2, 0.3), 1.4, [3, 6])
    if (s.flight && s.phase !== 'aim') this.drawTrail(s.flownPath())
    this.drawPlanets(s, bodies)
    this.drawRocks(s, now)
    this.drawDust(s, now)
    this.drawTarget(s, bodies, now, menu)
    if (s.phase === 'aim') this.drawAim(s, bodies, input, now)
    else this.drawFlyingShip(s, bodies, now)
    if (s.charge) this.drawCharge(s, now)
    else if (!menu && input.hover && s.canBoost) this.drawBoostHint(input.hover)
    this.drawParticles()
    this.drawPopups()

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    this.drawVignette(s, menu)
  }

  // ───────────────────────────────────────── backdrop

  private drawBackground(now: number): void {
    const ctx = this.ctx
    const { width: w, height: h } = this.camera
    ctx.fillStyle = COLORS.bg
    ctx.fillRect(-20, -20, w + 40, h + 40)
    const bg = this.assets.background
    const scale = Math.max(w / bg.width, h / bg.height) * 1.12
    const bw = bg.width * scale
    const bh = bg.height * scale
    const px = (this.camera.x * 6) % 40
    const py = (this.camera.y * 6) % 40
    ctx.globalAlpha = 0.9
    ctx.drawImage(bg, (w - bw) / 2 - px, (h - bh) / 2 + py, bw, bh)
    for (const st of this.stars) {
      const tw = st.tw ? 0.55 + 0.45 * Math.sin(now * st.tw + st.x) : 1
      ctx.globalAlpha = st.a * tw
      ctx.fillStyle = '#dfe9ff'
      ctx.fillRect(st.x - px * 0.4, st.y + py * 0.4, st.r, st.r)
    }
    ctx.globalAlpha = 1
  }

  private bodyViews(s: Session): BodyView[] {
    const cam = this.camera
    const sys = s.world.system
    const out: BodyView[] = []
    for (let i = 0; i < s.world.firstRock; i++) {
      const id = s.world.planetOf[i]!
      const c = CATALOG[id]
      const st = bodyState(sys, i, this.shownT)
      const phys = c.radius * cam.zoom
      const r = c.orbitRadius === null ? Math.max(phys * c.visual.enlarge, 15) : Math.max(phys * c.visual.enlarge, c.mu >= 0.002 ? 10 : 7)
      out.push({
        i, id, c, wx: st.x, wy: st.y, x: cam.sx(st.x), y: cam.sy(st.y), r,
        giant: c.mu >= GIANT_MU && c.orbitRadius !== null,
        well: sys.bodies[i].influenceRadius * cam.zoom,
      })
    }
    return out
  }

  private drawOrbits(s: Session, bodies: BodyView[]): void {
    const ctx = this.ctx
    const cx = this.camera.sx(0)
    const cy = this.camera.sy(0)
    for (const b of bodies) {
      if (b.c.orbitRadius === null) continue
      const target = b.i === s.world.targetIndex
      ctx.beginPath()
      ctx.arc(cx, cy, b.c.orbitRadius * this.camera.zoom, 0, Math.PI * 2)
      ctx.strokeStyle = target ? withAlpha(COLORS.gold, 0.26) : COLORS.orbit
      ctx.lineWidth = target ? 1.4 : 1
      ctx.stroke()
    }
  }

  /** The giants' gravity: a soft glow out to the radius where a slingshot happens. Lights up while the ship is in. */
  private drawWells(s: Session, bodies: BodyView[], now: number): void {
    const ctx = this.ctx
    const ship = s.phase === 'flight' ? s.ship(this.tmp) : null
    for (const b of bodies) {
      if (!b.giant || b.i === s.world.targetIndex || b.well < b.r * 1.3) continue
      let inside = 0
      if (ship) inside = 1 - smooth(0.7, 1.05, Math.hypot(ship.x - b.wx, ship.y - b.wy) / s.world.system.bodies[b.i].influenceRadius)
      const g = ctx.createRadialGradient(b.x, b.y, b.r, b.x, b.y, b.well)
      g.addColorStop(0, withAlpha(b.c.visual.color, 0.13 + inside * 0.16))
      g.addColorStop(0.6, withAlpha(b.c.visual.color, 0.04 + inside * 0.06))
      g.addColorStop(1, withAlpha(b.c.visual.color, 0))
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.arc(b.x, b.y, b.well, 0, Math.PI * 2)
      ctx.fill()
      ctx.save()
      ctx.setLineDash([2, 7])
      ctx.lineDashOffset = -now * 6
      ctx.strokeStyle = withAlpha(b.c.visual.color, 0.22 + inside * 0.35)
      ctx.lineWidth = 1.2
      ctx.beginPath()
      ctx.arc(b.x, b.y, b.well, 0, Math.PI * 2)
      ctx.stroke()
      ctx.restore()
    }
  }

  private drawPlanets(s: Session, bodies: BodyView[]): void {
    const ctx = this.ctx
    const star = bodies[0]
    drawStar(ctx, this.assets.planets.lyra, this.assets.starGlow, star.x, star.y, star.r, performance.now() / 1000, false)
    for (const b of bodies) {
      if (b.c.orbitRadius === null) continue
      const light = Math.atan2(star.y - b.y, star.x - b.x)
      const img = this.assets.planets[b.id]
      if (b.c.visual.rings) drawRingedPlanet(ctx, img, this.assets.rings, b.x, b.y, b.r, light, b.c.visual.color)
      else drawPlanetDisc(ctx, img, b.x, b.y, b.r, light, b.c.visual.color)
    }
    setFont(ctx, 11.5, 650)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    for (const b of bodies) {
      if (b.c.orbitRadius === null) continue
      const x = b.x
      const y = b.y + (b.c.visual.rings ? b.r * 1.15 : b.r) + 5
      if (x < -40 || x > this.camera.width + 40 || y < -20 || y > this.camera.height + 20) continue
      const important = b.i === s.world.targetIndex || b.i === s.world.homeIndex
      haloText(ctx, b.c.name, x, y, important ? COLORS.text : COLORS.text2, important ? 0.9 : 0.6)
    }
  }

  private drawRocks(s: Session, now: number): void {
    const ctx = this.ctx
    const cam = this.camera
    s.level.asteroids.forEach((a, k) => {
      const st = bodyState(s.world.system, s.world.firstRock + k, this.shownT)
      const x = cam.sx(st.x)
      const y = cam.sy(st.y)
      const size = Math.max(a.radius * cam.zoom * 2.3, 9)
      if (x < -size || x > cam.width + size || y < -size || y > cam.height + size) return
      const img = this.assets.asteroids[a.sprite % this.assets.asteroids.length]
      ctx.save()
      ctx.translate(x, y)
      ctx.rotate(k * 1.7 + now * (k % 2 ? 0.4 : -0.3))
      ctx.drawImage(img, -size / 2, (-size / 2) * (img.height / img.width), size, size * (img.height / img.width))
      ctx.restore()
    })
  }

  private drawDust(s: Session, now: number): void {
    const ctx = this.ctx
    const cam = this.camera
    const got = s.phase === 'aim' ? null : s.flight?.collected
    s.level.stardust.forEach(([wx, wy], i) => {
      if (got?.[i]) return
      const x = cam.sx(wx)
      const y = cam.sy(wy)
      const R = Math.max(STARDUST_RADIUS * cam.zoom, 9)
      const pulse = 1 + 0.08 * Math.sin(now * 3 + i * 2)
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      const g = ctx.createRadialGradient(x, y, 0, x, y, R * 1.9 * pulse)
      g.addColorStop(0, 'rgba(255, 226, 150, 0.55)')
      g.addColorStop(0.35, 'rgba(255, 196, 90, 0.2)')
      g.addColorStop(1, 'rgba(255, 170, 60, 0)')
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.arc(x, y, R * 1.9 * pulse, 0, Math.PI * 2)
      ctx.fill()
      // four-pointed sparkle
      ctx.translate(x, y)
      ctx.rotate(now * 0.5 + i)
      const a = R * 0.95 * pulse
      const w = a * 0.22
      ctx.fillStyle = '#FFF4D6'
      ctx.beginPath()
      for (let k = 0; k < 4; k++) {
        const ang = (k * Math.PI) / 2
        ctx.lineTo(Math.cos(ang) * a, Math.sin(ang) * a)
        ctx.lineTo(Math.cos(ang + Math.PI / 4) * w, Math.sin(ang + Math.PI / 4) * w)
      }
      ctx.closePath()
      ctx.fill()
      // motes circling it
      for (let k = 0; k < 3; k++) {
        const ang = -now * 1.3 + (k * Math.PI * 2) / 3 + i
        ctx.fillStyle = 'rgba(255, 214, 122, 0.9)'
        ctx.beginPath()
        ctx.arc(Math.cos(ang) * R * 1.15, Math.sin(ang) * R * 1.15, 1.4, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.restore()
    })
  }

  private drawTarget(s: Session, bodies: BodyView[], now: number, menu: boolean): void {
    const ctx = this.ctx
    const b = bodies[s.world.targetIndex]
    const R = Math.max(s.level.target.zoneRadius * this.camera.zoom, b.r + 9)
    const pulse = s.phase === 'arrived' ? 0 : Math.sin(now * 2.4) * 0.5 + 0.5
    ctx.save()
    ctx.fillStyle = withAlpha(COLORS.gold, 0.05 + pulse * 0.04)
    ctx.beginPath()
    ctx.arc(b.x, b.y, R, 0, Math.PI * 2)
    ctx.fill()
    ctx.setLineDash([7, 6])
    ctx.lineDashOffset = -now * 14
    ctx.strokeStyle = withAlpha(COLORS.gold, 0.6 + pulse * 0.3)
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(b.x, b.y, R, 0, Math.PI * 2)
    ctx.stroke()
    ctx.restore()
    if (!menu && s.phase !== 'arrived') {
      setFont(ctx, 10.5, 800)
      ctx.textAlign = 'center'
      ctx.textBaseline = 'bottom'
      haloText(ctx, 'ЦЕЛЬ', b.x, b.y - R - 5, COLORS.gold, 0.95)
    }
  }

  // ───────────────────────────────────────── paths

  private drawPolyline(path: Float32Array, color: string, width: number, dash: number[] | null): void {
    const ctx = this.ctx
    const cam = this.camera
    ctx.save()
    if (dash) ctx.setLineDash(dash)
    ctx.strokeStyle = color
    ctx.lineWidth = width
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    ctx.beginPath()
    let lx = NaN
    let ly = NaN
    for (let i = 0; i < path.length; i += 2) {
      const x = cam.sx(path[i])
      const y = cam.sy(path[i + 1])
      if (i === 0) ctx.moveTo(x, y)
      else if (Math.abs(x - lx) + Math.abs(y - ly) > 1.5 || i === path.length - 2) ctx.lineTo(x, y)
      else continue
      lx = x
      ly = y
    }
    ctx.stroke()
    ctx.restore()
  }

  private drawTrail(path: Float32Array): void {
    const ctx = this.ctx
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    this.drawPolyline(path, 'rgba(77, 207, 245, 0.16)', 7, null)
    ctx.restore()
    this.drawPolyline(path, 'rgba(140, 228, 255, 0.95)', 2.2, null)
  }

  /** Fading dots along the first part of the path; they drift forward so the aim feels alive. */
  private drawPreviewDots(r: PropagationResult, until: number, now: number, color: string, count: number): void {
    const ctx = this.ctx
    const cam = this.camera
    const t0 = r.samples[0]
    const span = Math.min(until, r.endTime) - t0
    if (span <= 0) return
    const phase = (now * 0.9) % 1
    for (let i = 0; i < count; i++) {
      const k = (i + phase) / count
      const s = sampleTrajectory(r.samples, r.sampleCount, t0 + span * k, this.tmp)
      ctx.globalAlpha = 0.22 + 0.78 * Math.pow(1 - k, 1.2)
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.arc(cam.sx(s.x), cam.sy(s.y), 1.3 + 2.1 * (1 - k), 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.globalAlpha = 1
    if (r.endReason !== 'collision' || r.endTime > t0 + span + 1e-9) {
      // "you will be here" — matches the faint planet copies drawn for the same moment
      const s = sampleTrajectory(r.samples, r.sampleCount, t0 + span, this.tmp)
      ctx.strokeStyle = color
      ctx.globalAlpha = 0.7
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.arc(cam.sx(s.x), cam.sy(s.y), 5, 0, Math.PI * 2)
      ctx.stroke()
      ctx.globalAlpha = 1
    }
    if (r.endReason === 'collision' && r.endTime <= t0 + span + 1e-9) {
      const s = sampleTrajectory(r.samples, r.sampleCount, r.endTime, this.tmp)
      const x = cam.sx(s.x)
      const y = cam.sy(s.y)
      ctx.strokeStyle = COLORS.red
      ctx.lineWidth = 2.5
      ctx.beginPath()
      ctx.moveTo(x - 6, y - 6)
      ctx.lineTo(x + 6, y + 6)
      ctx.moveTo(x + 6, y - 6)
      ctx.lineTo(x - 6, y + 6)
      ctx.stroke()
    }
  }

  /**
   * Where the giants and the target will be when the dots run out: a faint copy of the planet and the arc it
   * travels meanwhile. The dots say where the ship will be, the copies where the planets will be at that moment;
   * this is how the player learns to lead a moving target.
   */
  private drawEncounters(s: Session, r: PropagationResult, until: number, bodies: BodyView[]): void {
    const ctx = this.ctx
    const cam = this.camera
    const sys = s.world.system
    const tEnd = Math.min(until, r.endTime)
    const ship = sampleTrajectory(r.samples, r.sampleCount, tEnd, this.tmp)
    const cx = cam.sx(0)
    const cy = cam.sy(0)
    for (const b of bodies) {
      const isTarget = b.i === s.world.targetIndex
      if ((!b.giant && !isTarget) || b.c.orbitRadius === null) continue
      const p = bodyState(sys, b.i, tEnd)
      const reach = isTarget ? Math.max(1, s.level.target.zoneRadius * 7) : sys.bodies[b.i].influenceRadius * 2.5
      if (Math.hypot(ship.x - p.x, ship.y - p.y) > reach) continue
      const gx = cam.sx(p.x)
      const gy = cam.sy(p.y)
      if (Math.hypot(gx - b.x, gy - b.y) < b.r * 1.2) continue
      const R = b.c.orbitRadius * cam.zoom
      ctx.save()
      ctx.strokeStyle = withAlpha(b.c.visual.color, 0.5)
      ctx.lineWidth = 2
      ctx.setLineDash([2, 5])
      ctx.beginPath()
      ctx.arc(cx, cy, R, Math.atan2(gy - cy, gx - cx), Math.atan2(b.y - cy, b.x - cx))
      ctx.stroke()
      ctx.setLineDash([4, 4])
      ctx.beginPath()
      ctx.arc(gx, gy, b.r + 4, 0, Math.PI * 2)
      ctx.stroke()
      ctx.restore()
      const light = Math.atan2(cy - gy, cx - gx)
      const img = this.assets.planets[b.id]
      if (b.c.visual.rings) drawRingedPlanet(ctx, img, this.assets.rings, gx, gy, b.r, light, b.c.visual.color, 0.38)
      else drawPlanetDisc(ctx, img, gx, gy, b.r, light, b.c.visual.color, 0.38)
    }
  }

  // ───────────────────────────────────────── the ship

  private drawAim(s: Session, bodies: BodyView[], input: InputView, now: number): void {
    const ctx = this.ctx
    const home = bodies[s.world.homeIndex]
    const homeVel = bodyState(s.world.system, s.world.homeIndex, 0)
    // the ship sits on the home planet's edge, nose along the launch (or along the planet's motion)
    const aim = s.aim
    const dirX = aim ? aim.dvx : homeVel.vx
    const dirY = aim ? -aim.dvy : -homeVel.vy
    const len = Math.hypot(dirX, dirY) || 1
    const ux = dirX / len
    const uy = dirY / len
    const sx = home.x + ux * (home.r + 11)
    const sy = home.y + uy * (home.r + 11)
    this.shipX = home.x
    this.shipY = home.y

    // last attempt and the hint, as markers where the finger was
    const marker = (dvx: number, dvy: number, color: string, fill: boolean) => {
      const mx = home.x - (dvx / s.level.power) * input.maxPull
      const my = home.y + (dvy / s.level.power) * input.maxPull
      ctx.save()
      ctx.setLineDash([2, 4])
      ctx.strokeStyle = color
      ctx.lineWidth = 1.3
      ctx.beginPath()
      ctx.moveTo(home.x, home.y)
      ctx.lineTo(mx, my)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.beginPath()
      ctx.arc(mx, my, 7, 0, Math.PI * 2)
      if (fill) {
        ctx.fillStyle = color
        ctx.fill()
      } else ctx.stroke()
      ctx.restore()
    }
    if (s.ghost) marker(s.ghost.launch.dvx, s.ghost.launch.dvy, withAlpha(COLORS.text2, 0.55), false)
    if (input.showHint) {
      const p = 0.55 + 0.45 * Math.sin(now * 4)
      marker(s.level.reference.dvx, s.level.reference.dvy, withAlpha(COLORS.gold, 0.5 + 0.4 * p), true)
    }

    const preview = s.preview()
    const power = aim ? Math.hypot(aim.dvx, aim.dvy) / s.level.power : 0
    if (preview) {
      this.drawEncounters(s, preview, s.level.previewTime, bodies)
      this.drawPreviewDots(preview, s.level.previewTime, now, powerColor(power * 0.85), 30)
    }

    if (aim && input.pull) {
      // the rubber band: from both prongs around the planet to the grip under the finger
      const gx = home.x - (aim.dvx / s.level.power) * input.maxPull
      const gy = home.y + (aim.dvy / s.level.power) * input.maxPull
      const color = powerColor(power)
      ctx.save()
      ctx.strokeStyle = withAlpha(COLORS.text2, 0.16)
      ctx.setLineDash([3, 5])
      ctx.beginPath()
      ctx.arc(home.x, home.y, input.maxPull, 0, Math.PI * 2)
      ctx.stroke()
      ctx.setLineDash([])
      const px = -uy * (home.r + 4)
      const py = ux * (home.r + 4)
      ctx.strokeStyle = color
      ctx.lineCap = 'round'
      ctx.lineWidth = Math.max(1.5, 4 - power * 2.2)
      ctx.beginPath()
      ctx.moveTo(home.x + px, home.y + py)
      ctx.lineTo(gx, gy)
      ctx.lineTo(home.x - px, home.y - py)
      ctx.stroke()
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.arc(gx, gy, 6 + power * 3, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    } else if (input.teach) {
      // a ghost finger pulls back from the planet, again and again
      const k = (now % 2) / 2
      const pull = smooth(0.1, 0.7, k) * input.maxPull * 0.7
      const alpha = k < 0.8 ? 1 : 1 - (k - 0.8) / 0.2
      const fx = home.x - ux * pull
      const fy = home.y - uy * pull
      ctx.save()
      ctx.globalAlpha = alpha
      ctx.strokeStyle = withAlpha(COLORS.cyan, 0.6)
      ctx.lineWidth = 2
      ctx.setLineDash([4, 5])
      ctx.beginPath()
      ctx.moveTo(home.x, home.y)
      ctx.lineTo(fx, fy)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.fillStyle = 'rgba(255, 255, 255, 0.85)'
      ctx.beginPath()
      ctx.arc(fx, fy, 11, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = COLORS.cyan
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(fx, fy, 17 + 4 * Math.sin(now * 6), 0, Math.PI * 2)
      ctx.stroke()
      ctx.restore()
    }
    drawShip(ctx, this.assets.ship, sx, sy, Math.atan2(uy, ux), this.shipLength(), 0, now)
  }

  private shipLength(): number {
    return Math.min(this.camera.width, this.camera.height) < 600 ? 22 : 27
  }

  private drawFlyingShip(s: Session, bodies: BodyView[], now: number): void {
    const f = s.flight
    if (!f) return
    const st = s.ship(this.tmp)!
    let x = this.camera.sx(st.x)
    let y = this.camera.sy(st.y)
    let angle = Math.atan2(-st.vy, st.vx)
    if (s.phase === 'failed' && s.failure?.reason === 'crashed') return
    if (s.phase === 'arrived') {
      // parks on a little orbit around the target: a victory lap
      const b = bodies[s.world.targetIndex]
      if (this.arrival?.attempt !== s.attempts) {
        const cross = (x - b.x) * -st.vy - (y - b.y) * st.vx
        this.arrival = { attempt: s.attempts, angle: Math.atan2(y - b.y, x - b.x), dir: cross > 0 ? -1 : 1 }
      }
      const R = Math.max(b.r * 2, 24)
      const a = this.arrival.angle + this.arrival.dir * s.phaseClock * 2.4
      const k = smooth(0, 0.7, s.phaseClock)
      const ox = b.x + Math.cos(a) * R
      const oy = b.y + Math.sin(a) * R
      x = lerp(x, ox, k)
      y = lerp(y, oy, k)
      angle = a + (this.arrival.dir * Math.PI) / 2
    }
    const sinceBoost = now - this.lastBoostAt
    const thrust = Math.max(
      s.phase === 'flight' ? 1 - s.phaseClock / 0.7 : 0,
      sinceBoost < 0.6 ? 1 - sinceBoost / 0.6 : 0,
      s.charge ? 0.25 + 0.15 * Math.sin(now * 30) : 0,
    )
    this.shipX = x
    this.shipY = y
    shipGlow(this.ctx, x, y)
    drawShip(this.ctx, this.assets.ship, x, y, angle, this.shipLength(), thrust, now)
  }

  /** Charging a boost: an arrow that grows, a ring that fills, and where the boost would send the ship. */
  private drawCharge(s: Session, now: number): void {
    const ctx = this.ctx
    const c = s.charge!
    const f = s.flight!
    const level = s.chargeLevel
    const size = f.boostSize(level) / s.level.boostMax
    const preview = s.chargePreview()
    if (preview) {
      this.drawEncounters(s, preview, preview.endTime, this.bodyViews(s))
      this.drawPreviewDots(preview, preview.endTime, now, COLORS.amber, 22)
    }
    const len = Math.hypot(c.dirX, c.dirY) || 1
    const ux = c.dirX / len
    const uy = -c.dirY / len
    const L = 26 + 60 * size
    const x = this.shipX
    const y = this.shipY
    ctx.save()
    ctx.strokeStyle = COLORS.amber
    ctx.lineWidth = 3
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(x + ux * 16, y + uy * 16)
    ctx.lineTo(x + ux * L, y + uy * L)
    ctx.stroke()
    arrowHead(ctx, x + ux * (L + 4), y + uy * (L + 4), Math.atan2(uy, ux), 14, COLORS.amber)
    ctx.strokeStyle = withAlpha(COLORS.amber, 0.25)
    ctx.lineWidth = 4
    ctx.beginPath()
    ctx.arc(x, y, 22, 0, Math.PI * 2)
    ctx.stroke()
    ctx.strokeStyle = COLORS.amber
    ctx.beginPath()
    ctx.arc(x, y, 22, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * level)
    ctx.stroke()
    ctx.restore()
  }

  private drawBoostHint(p: { x: number; y: number }): void {
    const ctx = this.ctx
    const dx = p.x - this.shipX
    const dy = p.y - this.shipY
    const d = Math.hypot(dx, dy)
    if (d < 20) return
    const ux = dx / d
    const uy = dy / d
    ctx.save()
    ctx.strokeStyle = withAlpha(COLORS.amber, 0.45)
    ctx.lineWidth = 1.5
    ctx.setLineDash([3, 5])
    ctx.beginPath()
    ctx.moveTo(this.shipX + ux * 16, this.shipY + uy * 16)
    ctx.lineTo(this.shipX + ux * 44, this.shipY + uy * 44)
    ctx.stroke()
    ctx.restore()
    arrowHead(ctx, this.shipX + ux * 48, this.shipY + uy * 48, Math.atan2(uy, ux), 9, withAlpha(COLORS.amber, 0.6))
  }

  // ───────────────────────────────────────── effects

  private drawParticles(): void {
    const ctx = this.ctx
    const cam = this.camera
    for (const p of this.fx.particles) {
      const k = p.age / p.life
      const a = k < 0.15 ? 1 : 1 - (k - 0.15) / 0.85
      ctx.globalCompositeOperation = p.glow ? 'lighter' : 'source-over'
      ctx.globalAlpha = Math.max(0, a)
      ctx.fillStyle = p.color
      ctx.beginPath()
      ctx.arc(cam.sx(p.x), cam.sy(p.y), p.size * (p.glow ? 1 - k * 0.5 : 1 + k), 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
  }

  /** Floating captions, oldest first; a newer one slides below any it would cover. */
  private drawPopups(): void {
    const ctx = this.ctx
    const cam = this.camera
    const scale = Math.min(1, Math.max(0.66, Math.min(cam.width, cam.height) / 760))
    const placed: { top: number; bottom: number; left: number; right: number }[] = []
    for (const p of this.fx.popups) {
      if (p.age < 0) continue
      const k = p.age / p.life
      const size = p.size * scale
      const subSize = Math.round(size * 0.55)
      ctx.font = `700 ${size}px ${DISPLAY_FONT}`
      let w = ctx.measureText(p.text).width
      if (p.sub) {
        setFont(ctx, subSize, 800)
        w = Math.max(w, ctx.measureText(p.sub).width)
      }
      const up = size * 0.62
      const down = p.sub ? size * 0.85 + subSize * 0.7 : size * 0.62
      const x = Math.min(cam.width - w / 2 - 10, Math.max(w / 2 + 10, cam.sx(p.x)))
      let y = Math.min(cam.height - 70, Math.max(80, cam.sy(p.y) - 34 * scale - k * 30 * scale))
      for (let pass = 0; pass < 3; pass++) {
        for (const r of placed) {
          if (x + w / 2 > r.left && x - w / 2 < r.right && y - up < r.bottom && y + down > r.top) y = r.bottom + up + 4
        }
      }
      placed.push({ top: y - up, bottom: y + down, left: x - w / 2, right: x + w / 2 })

      const pop = p.age < 0.22 ? 1 + 0.45 * (1 - p.age / 0.22) : 1
      const alpha = k < 0.75 ? 1 : 1 - (k - 0.75) / 0.25
      ctx.save()
      ctx.globalAlpha = alpha
      ctx.translate(x, y)
      ctx.scale(pop, pop)
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.font = `700 ${size}px ${DISPLAY_FONT}`
      ctx.lineJoin = 'round'
      ctx.lineWidth = 6
      ctx.strokeStyle = 'rgba(5, 10, 24, 0.85)'
      ctx.shadowColor = p.color
      ctx.shadowBlur = 18
      ctx.strokeText(p.text, 0, 0)
      ctx.shadowBlur = 0
      ctx.fillStyle = p.color
      ctx.fillText(p.text, 0, 0)
      if (p.sub) {
        setFont(ctx, subSize, 800)
        ctx.lineWidth = 4
        ctx.strokeText(p.sub, 0, size * 0.85)
        ctx.fillStyle = COLORS.text
        ctx.fillText(p.sub, 0, size * 0.85)
      }
      ctx.restore()
    }
  }

  private drawVignette(s: Session, menu: boolean): void {
    const ctx = this.ctx
    const { width: w, height: h } = this.camera
    const slow = s.phase === 'flight' && !menu ? Math.max(0, 1 - s.timeScale / (s.level.pace * 0.7)) : 0
    const amount = Math.min(0.55, slow * 0.6 + (s.charge ? 0.2 : 0))
    if (amount > 0.01) {
      const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.hypot(w, h) * 0.6)
      g.addColorStop(0, 'rgba(3, 6, 16, 0)')
      g.addColorStop(1, `rgba(3, 6, 16, ${amount})`)
      ctx.fillStyle = g
      ctx.fillRect(0, 0, w, h)
    }
    if (this.fx.flash > 0) {
      ctx.globalCompositeOperation = 'lighter'
      ctx.fillStyle = `rgba(${this.fx.flashColor}, ${this.fx.flash * 0.35})`
      ctx.fillRect(0, 0, w, h)
      ctx.globalCompositeOperation = 'source-over'
    }
  }
}

/** Soft light around the ship so it reads at any zoom. */
function shipGlow(ctx: Ctx, x: number, y: number): void {
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  const g = ctx.createRadialGradient(x, y, 0, x, y, 26)
  g.addColorStop(0, 'rgba(120, 220, 255, 0.28)')
  g.addColorStop(1, 'rgba(120, 220, 255, 0)')
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.arc(x, y, 26, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}
