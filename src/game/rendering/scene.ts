import { CATALOG, type BodyId, type CatalogBody } from '../levels/catalog'
import type { MissionSystem } from '../levels/mission'
import type { LevelDef } from '../levels/types'
import { newSample, sampleTrajectory } from '../physics/interpolate'
import { burnToInertial, type PropagationResult } from '../physics/propagate'
import { bodyState } from '../physics/system'
import { KMS_PER_SPEED_UNIT, toDays, toKms } from '../physics/units'
import { sortedNodes, type Impulse, type Plan } from '../rules/plan'
import type { PredictResponse } from '../worker/protocol'
import type { Assets } from './assets'
import { Camera } from './camera'
import {
  arrowHead,
  callout,
  drawPlanetDisc,
  drawRingedPlanet,
  drawShip,
  drawStar,
  haloText,
  LabelBoard,
  ring,
  setFont,
  type Ctx,
} from './draw'
import { COLORS, withAlpha } from './palette'
import { buildScreenPath, buildScreenPathFrom, drawPath, pathIndexAt, type ScreenPath } from './trajectory'

export type SceneMode = 'menu' | 'plan' | 'flight' | 'result'
export type SelectionRef = { kind: 'launch' } | { kind: 'node'; id: string } | null

export interface Hover {
  kind: 'path' | 'handle' | 'node' | 'planet'
  t?: number
  x?: number
  y?: number
  id?: string
}

export interface MenuMarker {
  levelId: string
  levelNumber: number
  bodyId: BodyId
  locked: boolean
  stars: number
  selected: boolean
}

export interface SceneFrame {
  mode: SceneMode
  level: LevelDef
  mission: MissionSystem
  /** time at which bodies are drawn */
  time: number
  plan: Plan
  forecast: PredictResponse | null
  flown: PredictResponse | null
  ghost: PredictResponse | null
  showGhost: boolean
  /** draw the same flight without the gravity-assist planet, for comparison */
  showNoAssist: boolean
  selection: SelectionRef
  enlarge: boolean
  calm: boolean
  hover: Hover | null
  hintBody: BodyId | null
  /** handle length per km/s */
  pxPerKms: number
  /** Δv still available for the selected burn (model units) */
  availableDv: number
  canAddNode: boolean
  menuMarkers?: MenuMarker[]
  /** recent burn at playback time, 0..1, for the engine flame */
  thrust: number
}

/** Everything the input layer needs to hit-test the last frame. */
export interface SceneHits {
  path: ScreenPath | null
  nodes: { id: string; x: number; y: number }[]
  handle: { id: string; ox: number; oy: number; tx: number; ty: number; px: number; py: number } | null
  /** planets, and on the campaign map also mission badges (with their level id) */
  planets: { id: string; x: number; y: number; r: number }[]
  ship: { x: number; y: number; r: number } | null
}

interface Star {
  x: number
  y: number
  r: number
  a: number
  tw: number
}

/** Purely decorative far-background rocks in screen space (not part of the simulated system). */
interface Rock {
  /** position as a fraction of the viewport */
  fx: number
  fy: number
  size: number
  sprite: number
  spin: number
  phase: number
}

const ROCKS: Rock[] = [
  { fx: 0.93, fy: 0.62, size: 22, sprite: 0, spin: 0.05, phase: 0.3 },
  { fx: 0.97, fy: 0.7, size: 14, sprite: 3, spin: -0.07, phase: 1.1 },
  { fx: 0.89, fy: 0.74, size: 11, sprite: 5, spin: 0.09, phase: 2.2 },
  { fx: 0.95, fy: 0.8, size: 26, sprite: 1, spin: -0.04, phase: 0.8 },
  { fx: 0.86, fy: 0.86, size: 9, sprite: 6, spin: 0.08, phase: 3.1 },
  { fx: 0.91, fy: 0.92, size: 17, sprite: 2, spin: 0.06, phase: 1.7 },
  { fx: 0.99, fy: 0.9, size: 12, sprite: 7, spin: -0.1, phase: 0.1 },
]

const DAY = (t: number) => Math.round(toDays(t))

/** Campaign map only: square-root radial scale so the inner planets are not crammed around the star. */
const menuWarp = (r: number) => 2.7 * Math.sqrt(r)

export class Scene {
  readonly camera = new Camera()
  hits: SceneHits = { path: null, nodes: [], handle: null, planets: [], ship: null }
  private readonly ctx: Ctx
  private dpr = 1
  private stars: Star[] = []
  private board = new LabelBoard({ x: 0, y: 0, w: 1, h: 1 })
  private readonly tmp = newSample()
  /** wall-clock moment the played flight reached its target (for the arrival pulse) */
  private pulse: { key: PredictResponse; at: number } | null = null

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
    this.makeStars(width, height)
  }

  private makeStars(w: number, h: number): void {
    // deterministic sparse starfield
    let seed = 1234567
    const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646
    const count = Math.round((w * h) / 5200)
    this.stars = Array.from({ length: count }, () => ({
      x: rnd() * w,
      y: rnd() * h,
      r: rnd() < 0.92 ? 0.5 + rnd() * 0.7 : 1.2 + rnd() * 0.9,
      a: 0.25 + rnd() * 0.6,
      tw: rnd() < 0.12 ? 0.5 + rnd() * 2 : 0,
    }))
  }

  private nowSec = 0

  render(f: SceneFrame, nowSec: number): void {
    this.nowSec = nowSec
    const ctx = this.ctx
    const cam = this.camera
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    const { top, right, bottom, left } = cam.insets
    this.board.reset({ x: left + 4, y: top + 4, w: cam.width - left - right - 8, h: cam.height - top - bottom - 8 })
    this.hits = { path: null, nodes: [], handle: null, planets: [], ship: null }

    this.drawBackground(nowSec, f.calm)
    const bodies = this.bodyScreens(f)
    this.drawOrbits(f, bodies)

    if (f.mode === 'menu') {
      this.drawStarAndPlanets(f, bodies, nowSec)
      this.drawMenuOverlay(f, bodies, nowSec)
      return
    }

    const active = f.mode === 'plan' ? f.forecast : f.flown
    if (f.showGhost && f.mode === 'plan' && f.ghost && f.ghost !== f.forecast) {
      const gp = buildScreenPath(f.ghost.result, cam)
      drawPath(ctx, gp, { dashed: true, alpha: 0.32, width: 1.5, arrows: false, dashOffset: 0, glow: false, mono: COLORS.text2 })
    }

    this.drawEncounterGhosts(f, active, bodies)
    if (active && f.mode === 'plan') this.drawInfluenceZones(f, active, bodies)
    this.drawStarAndPlanets(f, bodies, nowSec)
    if (active && f.mode === 'plan' && f.showNoAssist) this.drawNoAssist(active, bodies)

    if (active) {
      const result = active.result
      const path = buildScreenPath(result, cam)
      this.hits.path = f.mode === 'plan' ? path : null
      const flow = f.calm ? 0 : -nowSec * 22
      if (f.mode === 'plan') {
        drawPath(ctx, path, { dashed: true, alpha: 0.95, width: 2.4, arrows: true, dashOffset: flow, glow: true })
      } else {
        const cut = pathIndexAt(path, f.time) + 1
        drawPath(ctx, path, { dashed: true, alpha: 0.5, width: 1.8, arrows: false, dashOffset: flow, glow: false }, Math.max(0, cut - 1))
        drawPath(ctx, path, { dashed: false, alpha: 1, width: 2.8, arrows: false, dashOffset: 0, glow: true }, 0, cut + 1)
      }
      this.drawEvents(f, active, bodies)
      if (f.mode === 'plan') {
        this.drawNodes(f, active)
        this.drawHoverAdd(f)
      }
      this.drawShipAt(f, result, nowSec)
    }
    this.drawTargetLabel(f, bodies)
  }

  // ───────────────────────────────────────────── background

  private drawBackground(nowSec: number, calm: boolean): void {
    const ctx = this.ctx
    const { width: w, height: h } = this.camera
    ctx.fillStyle = COLORS.bg
    ctx.fillRect(0, 0, w, h)
    const bg = this.assets.background
    const scale = Math.max(w / bg.width, h / bg.height) * 1.12
    const bw = bg.width * scale
    const bh = bg.height * scale
    const px = (this.camera.x * 6) % 40
    const py = (this.camera.y * 6) % 40
    ctx.globalAlpha = 0.9
    ctx.drawImage(bg, (w - bw) / 2 - px, (h - bh) / 2 + py, bw, bh)
    ctx.globalAlpha = 1
    for (const s of this.stars) {
      const tw = s.tw && !calm ? 0.55 + 0.45 * Math.sin(nowSec * s.tw + s.x) : 1
      ctx.globalAlpha = s.a * tw
      ctx.fillStyle = '#dfe9ff'
      ctx.fillRect(s.x, s.y, s.r, s.r)
    }
    ctx.globalAlpha = 0.5
    const rockScale = Math.min(1.4, Math.max(0.7, Math.min(w, h) / 800))
    for (const r of ROCKS) {
      const img = this.assets.asteroids[r.sprite]
      const size = r.size * rockScale
      const drift = calm ? 0 : Math.sin(nowSec * 0.1 + r.phase) * 4
      ctx.save()
      ctx.translate(r.fx * w - px * 0.5 + drift, r.fy * h + py * 0.5 - drift * 0.5)
      ctx.rotate(r.phase + (calm ? 0 : nowSec * r.spin))
      ctx.drawImage(img, -size / 2, (-size / 2) * (img.height / img.width), size, size * (img.height / img.width))
      ctx.restore()
    }
    ctx.globalAlpha = 1
  }

  // ───────────────────────────────────────────── bodies

  private renderRadius(c: CatalogBody, enlarge: boolean): number {
    const phys = c.radius * this.camera.zoom
    if (c.orbitRadius === null) return Math.max(phys * (enlarge ? c.visual.enlarge : 1), enlarge ? 15 : 4)
    if (!enlarge) return Math.max(phys, 2.5)
    return Math.max(phys * c.visual.enlarge, c.mu >= 0.002 ? 10 : 7)
  }

  private bodyScreens(f: SceneFrame) {
    // the campaign map is a showcase, not a simulation: planets drawn extra large and orbits spread out
    const menu = f.mode === 'menu'
    return f.mission.ids.map((id, i) => {
      const st = bodyState(f.mission.system, i, f.time)
      const c = CATALOG[id]
      const r = this.renderRadius(c, f.enlarge) * (menu ? (c.orbitRadius === null ? 1.3 : 1.75) : 1)
      const d = Math.hypot(st.x, st.y)
      const k = menu && d > 0 ? menuWarp(d) / d : 1
      return { id, i, c, x: this.camera.sx(st.x * k), y: this.camera.sy(st.y * k), wx: st.x, wy: st.y, r }
    })
  }

  private drawOrbits(f: SceneFrame, bodies: ReturnType<Scene['bodyScreens']>): void {
    const ctx = this.ctx
    const cx = this.camera.sx(0)
    const cy = this.camera.sy(0)
    for (const b of bodies) {
      if (b.c.orbitRadius === null) continue
      const isTarget = f.mode !== 'menu' && b.id === f.level.target.bodyId
      const radius = f.mode === 'menu' ? menuWarp(b.c.orbitRadius) : b.c.orbitRadius
      ctx.beginPath()
      ctx.arc(cx, cy, radius * this.camera.zoom, 0, Math.PI * 2)
      ctx.strokeStyle = isTarget ? withAlpha(COLORS.gold, 0.28) : COLORS.orbit
      ctx.lineWidth = isTarget ? 1.4 : 1
      ctx.stroke()
    }
  }

  private drawStarAndPlanets(f: SceneFrame, bodies: ReturnType<Scene['bodyScreens']>, nowSec: number): void {
    const ctx = this.ctx
    const star = bodies[0]
    drawStar(ctx, this.assets.planets.lyra, this.assets.starGlow, star.x, star.y, star.r, nowSec, f.calm)
    for (const b of bodies) {
      if (b.c.orbitRadius === null) continue
      const light = Math.atan2(star.y - b.y, star.x - b.x)
      const img = this.assets.planets[b.id]
      if (b.c.visual.rings) drawRingedPlanet(ctx, img, this.assets.rings, b.x, b.y, b.r, light, b.c.visual.color)
      else drawPlanetDisc(ctx, img, b.x, b.y, b.r, light, b.c.visual.color)
      this.hits.planets.push({ id: b.id, x: b.x, y: b.y, r: b.r })
    }
    // hint highlight
    if (f.hintBody && f.mode === 'plan') {
      const b = bodies.find((x) => x.id === f.hintBody)
      if (b) {
        const pulse = f.calm ? 0 : (Math.sin(nowSec * 3) + 1) * 3
        ring(ctx, b.x, b.y, b.r + 10 + pulse, withAlpha(COLORS.gold, 0.7), 1.5)
      }
    }
    // names: important bodies first, the rest only where they fit
    const priority = (id: BodyId) =>
      f.mode !== 'menu' && id === f.level.target.bodyId ? 0 : f.level.start.kind === 'docked' && id === f.level.start.bodyId ? 1 : id === 'lyra' ? 9 : 5
    setFont(ctx, 12.5, 650)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    for (const b of bodies) this.board.reserve({ x: b.x - b.r, y: b.y - b.r, w: b.r * 2, h: b.r * 2 })
    for (const b of [...bodies].sort((a, c) => priority(a.id) - priority(c.id))) {
      const below = b.c.visual.rings ? b.r * 1.15 : b.r
      const y = b.y + below + 6
      const w = ctx.measureText(b.c.name).width + 6
      const rect = { x: b.x - w / 2, y, w, h: 16 }
      if (priority(b.id) > 1 && !this.board.fits(rect)) continue
      haloText(ctx, b.c.name, b.x, y, COLORS.text, 0.88)
      this.board.reserve(rect)
    }
  }

  // ───────────────────────────────────────────── encounters

  /** Where the target / assisting planets will be when the ship gets there, and the arc they travel. */
  private drawEncounterGhosts(f: SceneFrame, active: PredictResponse | null, bodies: ReturnType<Scene['bodyScreens']>): void {
    if (!active || f.mode === 'menu') return
    const ctx = this.ctx
    const cam = this.camera
    const result = active.result
    const targetIndex = f.mission.indexOf(f.level.target.bodyId)
    const encounters: { index: number; t: number; color: string }[] = []
    const miss = active.outcome.miss
    const tTarget = result.arrival?.t ?? (miss && miss.kind !== 'short' && miss.kind !== 'long' ? miss.t : result.closest[targetIndex]?.t)
    if (tTarget !== undefined) encounters.push({ index: targetIndex, t: tTarget, color: COLORS.gold })
    for (const fb of result.flybys) if (fb.bodyIndex !== targetIndex) encounters.push({ index: fb.bodyIndex, t: fb.t, color: COLORS.amber })
    // a missed slingshot: where the helper planet is when the ship crosses its orbit
    const helper = miss?.assist
    if (helper && helper.miss.kind === 'timing') encounters.push({ index: f.mission.indexOf(helper.bodyId), t: helper.miss.t, color: COLORS.amber })

    for (const e of encounters) {
      const b = bodies[e.index]
      if (!b.c.orbitRadius) continue
      const future = bodyState(f.mission.system, e.index, e.t)
      const gx = cam.sx(future.x)
      const gy = cam.sy(future.y)
      const far = Math.hypot(gx - b.x, gy - b.y) > b.r * 1.2
      if (f.mode === 'plan' && far && e.t > f.time) {
        // the planet's own path until the encounter
        const a0 = Math.atan2(b.wy, b.wx)
        let a1 = Math.atan2(future.y, future.x)
        while (a1 < a0) a1 += Math.PI * 2
        const R = b.c.orbitRadius * cam.zoom
        const cx = cam.sx(0)
        const cy = cam.sy(0)
        ctx.save()
        ctx.strokeStyle = withAlpha(e.color, 0.55)
        ctx.lineWidth = 2
        ctx.setLineDash([3, 6])
        ctx.beginPath()
        ctx.arc(cx, cy, R, -a0, -a1, true)
        ctx.stroke()
        ctx.restore()
        const tangent = -a1 - Math.PI / 2
        arrowHead(ctx, cx + Math.cos(-a1) * R, cy + Math.sin(-a1) * R, tangent, 9, withAlpha(e.color, 0.8))
        // ghost
        const img = this.assets.planets[b.id]
        if (b.c.visual.rings) drawRingedPlanet(ctx, img, this.assets.rings, gx, gy, b.r, null, b.c.visual.color, 0.5)
        else drawPlanetDisc(ctx, img, gx, gy, b.r, null, b.c.visual.color, 0.5)
        this.board.reserve({ x: gx - b.r - 4, y: gy - b.r - 4, w: b.r * 2 + 8, h: b.r * 2 + 8 })
        ring(ctx, gx, gy, b.r + 2, withAlpha(e.color, 0.5), 1)
        if (e.color === COLORS.amber) this.influenceRing(gx, gy, e.index, f, 0.55)
        setFont(ctx, 11.5, 650)
        ctx.textAlign = 'center'
        ctx.textBaseline = 'bottom'
        const dt = e.t - f.time
        const txt = `${b.c.name} через ${DAY(dt)} дн.`
        haloText(ctx, txt, gx, gy - b.r * (b.c.visual.rings ? 1.0 : 1) - 8, withAlpha(e.color, 1), 0.9)
        this.board.reserve({ x: gx - 60, y: gy - b.r - 24, w: 120, h: 16 })
      }
      if (e.index === targetIndex) {
        // the goal zone: physical radius, drawn where the target will be at the encounter
        const zr = f.level.target.zoneRadius * cam.zoom
        ctx.save()
        ctx.setLineDash([6, 5])
        ctx.strokeStyle = withAlpha(COLORS.gold, 0.85)
        ctx.lineWidth = 1.6
        ctx.beginPath()
        ctx.arc(gx, gy, Math.max(zr, b.r + 4), 0, Math.PI * 2)
        ctx.stroke()
        ctx.restore()
      }
    }
  }

  // ───────────────────────────────────────────── gravity made visible

  /** Planets whose pull matters for this flight: the level's slingshot helper and every planet flown by. */
  private assistBodies(f: SceneFrame, active: PredictResponse): number[] {
    const ti = f.mission.indexOf(f.level.target.bodyId)
    const set = new Set<number>()
    if (f.level.hintBody && f.level.hintBody !== f.level.target.bodyId) set.add(f.mission.indexOf(f.level.hintBody))
    for (const fb of active.result.flybys) if (fb.bodyIndex !== ti) set.add(fb.bodyIndex)
    return [...set]
  }

  /** Dotted ring: inside it the planet pulls hard enough to bend the path (its sphere of influence). */
  private influenceRing(x: number, y: number, bodyIndex: number, f: SceneFrame, alpha: number): void {
    const r = f.mission.system.bodies[bodyIndex].influenceRadius * this.camera.zoom
    if (r < 8) return
    const ctx = this.ctx
    ctx.save()
    ctx.setLineDash([2, 6])
    ctx.lineCap = 'round'
    ctx.strokeStyle = withAlpha(COLORS.amber, alpha)
    ctx.lineWidth = 1.6
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.stroke()
    ctx.restore()
  }

  private drawInfluenceZones(f: SceneFrame, active: PredictResponse, bodies: ReturnType<Scene['bodyScreens']>): void {
    for (const i of this.assistBodies(f, active)) {
      const b = bodies[i]
      this.influenceRing(b.x, b.y, i, f, 0.35)
    }
  }

  /** The same flight without the slingshot planet's gravity: the gap to the real path is the planet's work. */
  private drawNoAssist(active: PredictResponse, bodies: ReturnType<Scene['bodyScreens']>): void {
    const na = active.noAssist
    if (!na || na.sampleCount < 2) return
    const ctx = this.ctx
    const cam = this.camera
    const path = buildScreenPathFrom(na.samples, na.sampleCount, cam, () => 'inbound', na.tFrom)
    if (path.n < 2) return
    drawPath(ctx, path, { dashed: true, alpha: 0.55, width: 1.6, arrows: false, dashOffset: 0, glow: false, mono: COLORS.text2 })
    const k = path.n - 1
    arrowHead(ctx, path.xs[k], path.ys[k], Math.atan2(path.ys[k] - path.ys[k - 1], path.xs[k] - path.xs[k - 1]), 9, withAlpha(COLORS.text2, 0.7))
    // label where the two paths have clearly parted
    const real = active.result
    for (let i = 0; i < path.n; i++) {
      const s = sampleTrajectory(real.samples, real.sampleCount, Math.min(path.ts[i], real.endTime), this.tmp)
      if (Math.hypot(cam.sx(s.x) - path.xs[i], cam.sy(s.y) - path.ys[i]) > 44) {
        setFont(ctx, 11.5, 650)
        const text = `так было бы без ${genitive(bodies[na.bodyIndex].c.name)}`
        const w = ctx.measureText(text).width + 8
        const rect = { x: path.xs[i] + 10, y: path.ys[i] - 8, w, h: 16 }
        if (!this.board.fits(rect)) {
          rect.x = path.xs[i] - 10 - w
        }
        if (this.board.fits(rect)) {
          ctx.textAlign = 'left'
          ctx.textBaseline = 'middle'
          haloText(ctx, text, rect.x + 4, path.ys[i], COLORS.text2, 0.95)
          this.board.reserve(rect)
        }
        break
      }
    }
  }

  // ───────────────────────────────────────────── events

  private drawEvents(f: SceneFrame, active: PredictResponse, bodies: ReturnType<Scene['bodyScreens']>): void {
    const ctx = this.ctx
    const cam = this.camera
    const { result, outcome } = active
    const visibleUntil = f.mode === 'flight' ? f.time : Infinity

    for (const fb of result.flybys) {
      if (!fb.complete || fb.bodyIndex === f.mission.indexOf(f.level.target.bodyId)) continue
      if (fb.t > visibleUntil) continue
      const x = cam.sx(fb.x)
      const y = cam.sy(fb.y)
      ring(ctx, x, y, 6, COLORS.amber, 2, COLORS.bg)
      ring(ctx, x, y, 2, COLORS.text, 2)
      const gain = gravityGain(fb)
      const name = bodies[fb.bodyIndex].c.name
      callout(ctx, x, y, {
        color: COLORS.amber,
        title: true,
        lines: ['Гравитационный манёвр', `${gain >= 0 ? 'разгон' : 'торможение'} у ${genitive(name)}: ${gain >= 0 ? '+' : '−'}${fmtKms(Math.abs(gain))} без топлива`],
        board: this.board,
      })
    }

    if (result.arrival && result.arrival.t <= visibleUntil) {
      const x = cam.sx(result.arrival.x)
      const y = cam.sy(result.arrival.y)
      if (f.mode !== 'plan' && outcome.success && !f.calm) {
        if (this.pulse?.key !== active) this.pulse = { key: active, at: this.nowSec }
        const age = this.nowSec - this.pulse.at
        for (let k = 0; k < 3; k++) {
          const p = (age - k * 0.35) / 1.6
          if (p > 0 && p < 1) ring(ctx, x, y, 10 + p * 70, withAlpha(COLORS.green, (1 - p) * 0.8), 2.5 * (1 - p) + 0.5)
        }
      }
      ring(ctx, x, y, 8, outcome.success ? COLORS.green : COLORS.amber, 2.2, COLORS.bg)
      ring(ctx, x, y, 3, COLORS.text, 2)
      const late = outcome.failure === 'deadline'
      callout(ctx, x, y, {
        color: late ? COLORS.amber : COLORS.green,
        title: true,
        lines: late
          ? ['Опоздание', `прибытие на ${DAY(outcome.flightTime)}-й день полёта`]
          : ['Цель достигнута', `на ${DAY(outcome.flightTime)}-й день полёта`],
        board: this.board,
      })
    } else if (result.collision && result.collision.t <= visibleUntil) {
      const x = cam.sx(result.collision.x)
      const y = cam.sy(result.collision.y)
      ctx.save()
      ctx.strokeStyle = COLORS.red
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.moveTo(x - 7, y - 7)
      ctx.lineTo(x + 7, y + 7)
      ctx.moveTo(x + 7, y - 7)
      ctx.lineTo(x - 7, y + 7)
      ctx.stroke()
      ctx.restore()
      const name = bodies[result.collision.bodyIndex].c.name
      callout(ctx, x, y, {
        color: COLORS.red,
        title: true,
        lines: [`Столкновение: ${name}`, `${DAY(result.collision.t - (result.samples[0] ?? 0))}-й день полёта`],
        board: this.board,
      })
    } else if (f.mode !== 'flight' || f.time >= result.endTime) {
      this.drawMiss(f, active, bodies)
    }
    if (outcome.failure === 'too-fast' && outcome.fastPass && outcome.fastPass.t <= visibleUntil) {
      const fp = outcome.fastPass
      const x = cam.sx(fp.x)
      const y = cam.sy(fp.y)
      ring(ctx, x, y, 6, COLORS.amber, 2, COLORS.bg)
      callout(ctx, x, y, {
        color: COLORS.amber,
        title: true,
        lines: ['Скорости не совпали', `разница ${fmtKms(toKms(fp.relSpeed))}, нужно не больше ${fmtKms(toKms(f.level.target.maxRelSpeed ?? 0))}`],
        board: this.board,
      })
    }
  }

  private drawMiss(f: SceneFrame, active: PredictResponse, bodies: ReturnType<Scene['bodyScreens']>): void {
    const ctx = this.ctx
    const cam = this.camera
    const { result, outcome } = active
    const ti = f.mission.indexOf(f.level.target.bodyId)
    const target = bodies[ti]
    const report = outcome.miss
    if (!report) return
    // slingshot levels: talk about the helper planet the ship failed to meet
    const helperTiming = report.assist?.miss.kind === 'timing' ? report.assist : null
    const m = helperTiming ? helperTiming.miss : report
    const x = cam.sx(m.x)
    const y = cam.sy(m.y)
    const t0 = result.samples[0]
    ctx.save()
    ctx.setLineDash([4, 5])
    ctx.strokeStyle = withAlpha(COLORS.red, 0.75)
    ctx.lineWidth = 1.4
    ctx.beginPath()
    ctx.moveTo(x, y)
    if (m.kind === 'short' || m.kind === 'long') {
      // radial gap to the target's orbit
      const r = Math.hypot(m.x, m.y)
      const a = target.c.orbitRadius ?? r
      ctx.lineTo(cam.sx((m.x / r) * a), cam.sy((m.y / r) * a))
    } else {
      const bi = helperTiming ? f.mission.indexOf(helperTiming.bodyId) : ti
      const tp = bodyState(f.mission.system, bi, m.t)
      ctx.lineTo(cam.sx(tp.x), cam.sy(tp.y))
    }
    ctx.stroke()
    ctx.restore()
    ring(ctx, x, y, 5, COLORS.red, 2, COLORS.bg)
    const name = helperTiming ? CATALOG[helperTiming.bodyId].name : target.c.name
    let lines: string[]
    if (m.kind === 'short') lines = [`Не долетаете до орбиты`, `не хватает ${fmtMkm(m.gap)}`]
    else if (m.kind === 'long') lines = [`Не опускаетесь до орбиты`, `не хватает ${fmtMkm(m.gap)}`]
    else if (m.kind === 'timing') {
      const d = Math.max(1, DAY(Math.abs(m.lag)))
      const passed = name.endsWith('а') ? 'прошла' : 'прошёл'
      const head = helperTiming
        ? `Здесь нужна праща у ${genitive(name)}`
        : m.lag > 0
          ? `${name} не успевает сюда на ${d} дн.`
          : `${name} ${passed} здесь ${d} дн. назад`
      // say what to do, not only what went wrong: the launch-date change that fixes the timing
      const shift = m.launchShift !== null ? DAY(m.launchShift) : 0
      const todo =
        shift !== 0
          ? `сдвиньте старт на ${Math.abs(shift)} дн. ${shift > 0 ? 'позже' : 'раньше'}`
          : m.lag > 0
            ? 'прилетите сюда позже'
            : 'прилетите сюда раньше'
      lines = [head, todo]
    } else lines = ['Промах', `${fmtMkm(Math.max(0, m.distance - f.level.target.zoneRadius))} до кольца цели, ${DAY(m.t - t0)}-й день`]
    callout(ctx, x, y, { color: COLORS.red, title: true, lines, board: this.board })
  }

  // ───────────────────────────────────────────── nodes & handle

  private nodeFrame(f: SceneFrame, active: PredictResponse, sel: Exclude<SelectionRef, null>) {
    const result = active.result
    const nodes = sortedNodes(f.plan)
    const orbitStart = f.level.start.kind === 'orbit'
    if (sel.kind === 'launch') {
      const s0 = result.samples
      let vx: number
      let vy: number
      if (f.level.start.kind === 'docked') {
        const home = bodyState(f.mission.system, f.mission.indexOf(f.level.start.bodyId), f.plan.launchTime)
        vx = home.vx
        vy = home.vy
      } else {
        const rec = result.burns[0]
        vx = rec?.vxBefore ?? s0[3]
        vy = rec?.vyBefore ?? s0[4]
      }
      return { x: s0[1], y: s0[2], vx, vy, impulse: f.plan.launch as Impulse, applied: true }
    }
    const k = nodes.findIndex((n) => n.id === sel.id)
    if (k < 0) return null
    const rec = result.burns[k + (orbitStart ? 1 : 0)]
    const node = nodes[k]
    if (rec && rec.applied) return { x: rec.x, y: rec.y, vx: rec.vxBefore, vy: rec.vyBefore, impulse: node as Impulse, applied: true }
    // not reached: show it where the trajectory ends
    const end = sampleTrajectory(result.samples, result.sampleCount, result.endTime, this.tmp)
    return { x: end.x, y: end.y, vx: end.vx, vy: end.vy, impulse: node as Impulse, applied: false }
  }

  private drawNodes(f: SceneFrame, active: PredictResponse): void {
    const ctx = this.ctx
    const cam = this.camera
    const ids: SelectionRef[] = [{ kind: 'launch' }, ...sortedNodes(f.plan).map((n) => ({ kind: 'node' as const, id: n.id }))]
    ids.forEach((sel, idx) => {
      if (!sel) return
      const nf = this.nodeFrame(f, active, sel)
      if (!nf) return
      const x = cam.sx(nf.x)
      const y = cam.sy(nf.y)
      const id = sel.kind === 'launch' ? 'launch' : sel.id
      const selected =
        f.selection !== null &&
        ((f.selection.kind === 'launch' && sel.kind === 'launch') ||
          (f.selection.kind === 'node' && sel.kind === 'node' && f.selection.id === sel.id))
      this.hits.nodes.push({ id, x, y })
      const color = nf.applied ? COLORS.cyan : COLORS.red
      const homeId = f.level.start.kind === 'docked' && sel.kind === 'launch' ? f.level.start.bodyId : null
      if (homeId) {
        // the launch happens at the planet itself: circle it instead of covering it
        const hr = this.renderRadius(CATALOG[homeId], f.enlarge) + (selected ? 7 : 5)
        ring(ctx, x, y, hr, withAlpha(color, selected ? 1 : 0.8), selected ? 2.4 : 1.8)
      } else {
        ring(ctx, x, y, selected ? 10 : 8, color, 2.4, 'rgba(8, 15, 32, 0.9)')
        ring(ctx, x, y, 3.2, COLORS.text, 2.4)
      }
      if (sel.kind === 'launch' && !selected) {
        callout(ctx, x, y, { color: COLORS.cyan, lines: [f.level.start.kind === 'docked' ? 'Старт' : 'Зонд'], board: this.board, distance: 22 })
      } else if (sel.kind === 'node' && !selected) {
        setFont(ctx, 11, 700)
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        haloText(ctx, String(idx + 1), x, y - 17, COLORS.cyan)
      }
      if (selected) this.drawHandle(f, nf, id, x, y)
    })
  }

  private drawHandle(
    f: SceneFrame,
    nf: { vx: number; vy: number; impulse: Impulse },
    id: string,
    x: number,
    y: number,
  ): void {
    const ctx = this.ctx
    const v = Math.hypot(nf.vx, nf.vy) || 1
    const px = nf.vx / v
    const py = nf.vy / v
    const scale = f.pxPerKms * KMS_PER_SPEED_UNIT
    const { dvx, dvy } = burnToInertial(nf.vx, nf.vy, nf.impulse.prograde, nf.impulse.radial)
    const tx = x + dvx * scale
    const ty = y - dvy * scale
    const mag = Math.hypot(nf.impulse.prograde, nf.impulse.radial)
    const maxR = (mag + f.availableDv) * scale

    ctx.save()
    // reach of the remaining budget
    ctx.setLineDash([3, 5])
    ctx.strokeStyle = withAlpha(COLORS.green, 0.35)
    ctx.lineWidth = 1.2
    ctx.beginPath()
    ctx.arc(x, y, Math.max(maxR, 4), 0, Math.PI * 2)
    ctx.stroke()
    // prograde / radial axes
    ctx.strokeStyle = withAlpha(COLORS.text2, 0.38)
    ctx.beginPath()
    ctx.moveTo(x - px * maxR, y + py * maxR)
    ctx.lineTo(x + px * maxR, y - py * maxR)
    ctx.moveTo(x - py * maxR * 0.5, y - px * maxR * 0.5)
    ctx.lineTo(x + py * maxR * 0.5, y + px * maxR * 0.5)
    ctx.stroke()
    ctx.setLineDash([])
    arrowHead(ctx, x + px * maxR, y - py * maxR, Math.atan2(-py, px), 8, withAlpha(COLORS.text2, 0.6))
    setFont(ctx, 10.5, 650)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const fx = x + px * (maxR + 22)
    const fy = y - py * (maxR + 22)
    const fw = ctx.measureText('вперёд').width + 6
    const fr = { x: fx - fw / 2, y: fy - 8, w: fw, h: 16 }
    if (this.board.fits(fr)) {
      haloText(ctx, 'вперёд', fx, fy, COLORS.text2, 0.8)
      this.board.reserve(fr)
    }

    // the Δv arrow
    if (mag > 1e-9) {
      ctx.strokeStyle = COLORS.green
      ctx.lineWidth = 3
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(x, y)
      ctx.lineTo(tx, ty)
      ctx.stroke()
      arrowHead(ctx, tx, ty, Math.atan2(ty - y, tx - x), 13, COLORS.green)
    }
    ring(ctx, tx, ty, 11, COLORS.green, 2.5, withAlpha(COLORS.green, 0.22))
    ring(ctx, tx, ty, 3, COLORS.text, 2)
    setFont(ctx, 12.5, 750)
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    const label = fmtKms(toKms(mag) / 1, true)
    const lx = tx + (tx >= x ? 16 : -16 - ctx.measureText(label).width)
    haloText(ctx, label, lx, ty - 14, COLORS.green)
    ctx.restore()
    this.hits.handle = { id, ox: x, oy: y, tx, ty, px, py }
  }

  private drawHoverAdd(f: SceneFrame): void {
    const h = f.hover
    if (!h || h.kind !== 'path' || h.x === undefined || h.y === undefined || !f.canAddNode) return
    const ctx = this.ctx
    ring(ctx, h.x, h.y, 8, withAlpha(COLORS.cyan, 0.9), 2, 'rgba(8, 15, 32, 0.8)')
    ctx.strokeStyle = COLORS.cyan
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(h.x - 4, h.y)
    ctx.lineTo(h.x + 4, h.y)
    ctx.moveTo(h.x, h.y - 4)
    ctx.lineTo(h.x, h.y + 4)
    ctx.stroke()
    setFont(ctx, 11.5, 650)
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    haloText(ctx, `Импульс на ${DAY(h.t! - f.plan.launchTime)}-й день`, h.x + 14, h.y - 14, COLORS.cyan)
  }

  // ───────────────────────────────────────────── ship & labels

  private drawShipAt(f: SceneFrame, result: PropagationResult, nowSec: number): void {
    const t0 = result.samples[0]
    const cam = this.camera
    let x: number
    let y: number
    let angle: number
    if (f.time < t0 && f.level.start.kind === 'docked') {
      const hi = f.mission.indexOf(f.level.start.bodyId)
      const home = bodyState(f.mission.system, hi, f.time)
      x = cam.sx(home.x)
      y = cam.sy(home.y)
      angle = Math.atan2(-home.vy, home.vx)
    } else {
      const s = sampleTrajectory(result.samples, result.sampleCount, Math.min(f.time, result.endTime), this.tmp)
      x = cam.sx(s.x)
      y = cam.sy(s.y)
      angle = Math.atan2(-s.vy, s.vx)
    }
    const length = Math.min(52, Math.max(f.mode === 'plan' ? 28 : 36, cam.zoom * 0.12))
    if (f.level.start.kind === 'docked' && f.time <= t0 + 1e-6) {
      // waiting at the home planet: park the ship on its rim, nose along the launch direction
      const hr = this.renderRadius(CATALOG[f.level.start.bodyId], f.enlarge)
      const s0 = result.samples
      const home = bodyState(f.mission.system, f.mission.indexOf(f.level.start.bodyId), t0)
      const rvx = s0[3] - home.vx
      const rvy = s0[4] - home.vy
      // launch Δv direction, or the planet's motion when there is no impulse yet
      const a = Math.hypot(rvx, rvy) > 1e-9 ? Math.atan2(-rvy, rvx) : Math.atan2(-home.vy, home.vx)
      const sx = x + Math.cos(a) * (hr + length * 0.35)
      const sy = y + Math.sin(a) * (hr + length * 0.35)
      drawShip(this.ctx, this.assets.ship, sx, sy, a, length * 0.8, 0, nowSec)
      this.hits.ship = { x: sx, y: sy, r: length * 0.45 }
      return
    }
    if (f.mode !== 'plan') {
      // soft beacon so the small ship never gets lost against a planet
      const g = this.ctx.createRadialGradient(x, y, 0, x, y, length * 0.9)
      g.addColorStop(0, withAlpha(COLORS.cyan, 0.28))
      g.addColorStop(1, withAlpha(COLORS.cyan, 0))
      this.ctx.fillStyle = g
      this.ctx.beginPath()
      this.ctx.arc(x, y, length * 0.9, 0, Math.PI * 2)
      this.ctx.fill()
    }
    drawShip(this.ctx, this.assets.ship, x, y, angle, length, f.thrust, nowSec)
    this.hits.ship = { x, y, r: length * 0.45 }
  }

  private drawTargetLabel(f: SceneFrame, bodies: ReturnType<Scene['bodyScreens']>): void {
    const b = bodies[f.mission.indexOf(f.level.target.bodyId)]
    const cam = this.camera
    const zr = Math.max(f.level.target.zoneRadius * cam.zoom, b.r + 4)
    ring(this.ctx, b.x, b.y, zr, withAlpha(COLORS.gold, 0.45), 1.2)
    callout(this.ctx, b.x + zr * 0.7, b.y - zr * 0.7, { color: COLORS.gold, title: true, lines: ['Цель'], board: this.board, distance: 20 })
  }

  // ───────────────────────────────────────────── menu

  private drawMenuOverlay(f: SceneFrame, bodies: ReturnType<Scene['bodyScreens']>, nowSec: number): void {
    const markers = f.menuMarkers ?? []
    const ctx = this.ctx
    const pos = (id: BodyId) => bodies.find((b) => b.id === id) ?? bodies[0]
    // campaign route: home → mission targets in order
    const route = [pos('aqua'), ...markers.map((m) => pos(m.bodyId))]
    ctx.save()
    ctx.setLineDash([5, 7])
    ctx.lineDashOffset = f.calm ? 0 : -nowSec * 10
    ctx.lineWidth = 1.6
    for (let i = 1; i < route.length; i++) {
      const a = route[i - 1]
      const b = route[i]
      const locked = markers[i - 1].locked
      ctx.strokeStyle = locked ? 'rgba(169, 188, 213, 0.28)' : withAlpha(COLORS.cyan, 0.7)
      const mx = (a.x + b.x) / 2
      const my = (a.y + b.y) / 2
      const nx = -(b.y - a.y) * 0.18
      const ny = (b.x - a.x) * 0.18
      ctx.beginPath()
      ctx.moveTo(a.x, a.y)
      ctx.quadraticCurveTo(mx + nx, my + ny, b.x, b.y)
      ctx.stroke()
    }
    ctx.restore()
    // stack markers that share a planet
    const seen = new Map<BodyId, number>()
    for (const m of markers) {
      const b = pos(m.bodyId)
      const k = seen.get(m.bodyId) ?? 0
      seen.set(m.bodyId, k + 1)
      const x = b.x + b.r * 0.9 + 18 + k * 34
      const y = b.y - b.r * 0.9 - 14
      const color = m.locked ? COLORS.text2 : m.selected ? COLORS.cyan : COLORS.text
      if (m.selected) ring(ctx, b.x, b.y, b.r + 8 + (f.calm ? 0 : Math.sin(nowSec * 3) * 2), withAlpha(COLORS.cyan, 0.7), 2)
      ring(ctx, x, y, 14, color, m.selected ? 2.5 : 1.6, 'rgba(8, 15, 32, 0.85)')
      setFont(ctx, 13, 800)
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = color
      ctx.fillText(String(m.levelNumber), x, y + 0.5)
      for (let s = 0; s < 3; s++) {
        ctx.beginPath()
        ctx.arc(x - 8 + s * 8, y + 21, 2.6, 0, Math.PI * 2)
        ctx.fillStyle = s < m.stars ? COLORS.gold : 'rgba(169, 188, 213, 0.3)'
        ctx.fill()
      }
      this.hits.planets.unshift({ id: m.levelId, x, y, r: 16 })
    }
  }
}

// ───────────────────────────────────────────── formatting helpers

/** Heliocentric speed change the planet's gravity alone is worth, measured at the entry distance (energy based). */
export function gravityGain(fb: { energyIn: number; energyOut: number; speedIn: number; burnEnergy: number }): number {
  const v2 = fb.speedIn * fb.speedIn + 2 * (fb.energyOut - fb.energyIn - fb.burnEnergy)
  return toKms(Math.sqrt(Math.max(0, v2)) - fb.speedIn)
}

export function fmtKms(kms: number, unit = true): string {
  const s = kms.toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: kms < 1 ? 2 : 1 })
  return unit ? `${s} км/с` : s
}

export function fmtMkm(d: number): string {
  const mkm = (d * 1.5e8) / 1e6
  return `${mkm.toLocaleString('ru-RU', { maximumFractionDigits: mkm < 10 ? 1 : 0 })} млн км`
}

const GENITIVE: Record<string, string> = {
  Лира: 'Лиры',
  Пепел: 'Пепла',
  Аква: 'Аквы',
  Рубра: 'Рубры',
  Колосс: 'Колосса',
  Аурум: 'Аурума',
  Борей: 'Борея',
  Виола: 'Виолы',
}
export const genitive = (name: string): string => GENITIVE[name] ?? name
