import { fromKms, KMS_PER_SPEED_UNIT } from '../physics/units'
import type { Impulse } from '../rules/plan'
import type { Hover, Scene } from '../rendering/scene'
import { nearestOnPath } from '../rendering/trajectory'

export interface InteractionHandlers {
  /** planning allowed (handle drag, adding nodes) */
  canEdit: () => boolean
  canAddNode: () => boolean
  pxPerKms: () => number
  onSelect: (id: string) => void
  onHandle: (id: string, impulse: Impulse) => void
  onAddNode: (t: number) => void
  onGestureStart: () => void
  onGestureEnd: () => void
  /** planets react to taps (mission map); returns true when the tap was used */
  planetsInteractive: () => boolean
  onTapPlanet: (id: string) => void
}

interface PointerInfo {
  x: number
  y: number
  startX: number
  startY: number
  type: string
}

type Drag =
  | { kind: 'none' }
  | { kind: 'pending'; id: number }
  | { kind: 'pan'; id: number }
  | { kind: 'handle'; id: number; handleId: string }
  | { kind: 'pinch'; dist: number; mx: number; my: number }

const TAP_SLOP = 7
/** snap the Δv direction to prograde / retrograde / radial within this angle */
const SNAP_RAD = (3.5 * Math.PI) / 180

/** Pointer, wheel and pinch input on the game canvas. */
export class Interaction {
  hover: Hover | null = null
  private pointers = new Map<number, PointerInfo>()
  private drag: Drag = { kind: 'none' }
  private readonly abort = new AbortController()

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly scene: Scene,
    private readonly h: InteractionHandlers,
  ) {
    const opts = { signal: this.abort.signal }
    canvas.addEventListener('pointerdown', (e) => this.down(e), opts)
    canvas.addEventListener('pointermove', (e) => this.move(e), opts)
    canvas.addEventListener('pointerup', (e) => this.up(e), opts)
    canvas.addEventListener('pointercancel', (e) => this.up(e, true), opts)
    canvas.addEventListener('pointerleave', () => {
      if (this.drag.kind === 'none') this.setHover(null)
    }, opts)
    canvas.addEventListener('wheel', (e) => this.wheel(e), { ...opts, passive: false })
  }

  dispose(): void {
    this.abort.abort()
  }

  private local(e: PointerEvent | WheelEvent): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  private radius(type: string, base: number): number {
    return type === 'touch' ? base * 1.8 : base
  }

  private down(e: PointerEvent): void {
    const p = this.local(e)
    this.canvas.setPointerCapture(e.pointerId)
    this.pointers.set(e.pointerId, { ...p, startX: p.x, startY: p.y, type: e.pointerType })
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()]
      if (this.drag.kind === 'handle') this.h.onGestureEnd()
      this.drag = { kind: 'pinch', dist: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 }
      return
    }
    if (this.pointers.size > 2) return

    const hits = this.scene.hits
    const hd = hits.handle
    if (hd && this.h.canEdit() && Math.hypot(p.x - hd.tx, p.y - hd.ty) <= this.radius(e.pointerType, 16)) {
      this.drag = { kind: 'handle', id: e.pointerId, handleId: hd.id }
      this.h.onGestureStart()
      this.canvas.style.cursor = 'grabbing'
      return
    }
    this.drag = { kind: 'pending', id: e.pointerId }
  }

  private move(e: PointerEvent): void {
    const p = this.local(e)
    const info = this.pointers.get(e.pointerId)
    if (!info) {
      if (e.pointerType === 'mouse') this.updateHover(p.x, p.y)
      return
    }
    const dx = p.x - info.x
    const dy = p.y - info.y
    info.x = p.x
    info.y = p.y

    switch (this.drag.kind) {
      case 'pinch': {
        const [a, b] = [...this.pointers.values()]
        if (!a || !b) return
        const dist = Math.hypot(a.x - b.x, a.y - b.y)
        const mx = (a.x + b.x) / 2
        const my = (a.y + b.y) / 2
        this.scene.camera.pan(mx - this.drag.mx, my - this.drag.my)
        if (this.drag.dist > 0) this.scene.camera.zoomAt(mx, my, dist / this.drag.dist)
        this.drag = { kind: 'pinch', dist, mx, my }
        return
      }
      case 'handle':
        if (e.pointerId === this.drag.id) this.dragHandle(this.drag.handleId, p.x, p.y)
        return
      case 'pending':
        if (Math.hypot(p.x - info.startX, p.y - info.startY) > TAP_SLOP) {
          this.drag = { kind: 'pan', id: e.pointerId }
          this.canvas.style.cursor = 'grabbing'
          this.scene.camera.pan(p.x - info.startX, p.y - info.startY)
        }
        return
      case 'pan':
        this.scene.camera.pan(dx, dy)
        return
      default:
        if (e.pointerType === 'mouse') this.updateHover(p.x, p.y)
    }
  }

  private up(e: PointerEvent, cancelled = false): void {
    const info = this.pointers.get(e.pointerId)
    this.pointers.delete(e.pointerId)
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId)
    const drag = this.drag
    if (drag.kind === 'pinch') {
      if (this.pointers.size === 0) this.drag = { kind: 'none' }
      else {
        const [rest] = [...this.pointers.entries()]
        this.drag = { kind: 'pan', id: rest[0] }
      }
      return
    }
    this.drag = { kind: 'none' }
    this.canvas.style.cursor = ''
    if (drag.kind === 'handle') {
      this.h.onGestureEnd()
      return
    }
    if (drag.kind === 'pending' && info && !cancelled) this.tap(info.x, info.y, info.type)
    if (e.pointerType === 'mouse' && info) this.updateHover(info.x, info.y)
  }

  private wheel(e: WheelEvent): void {
    e.preventDefault()
    const p = this.local(e)
    const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY
    this.scene.camera.zoomAt(p.x, p.y, Math.exp(-delta * 0.0015))
  }

  private tap(x: number, y: number, type: string): void {
    const hits = this.scene.hits
    const node = hits.nodes.find((n) => Math.hypot(n.x - x, n.y - y) <= this.radius(type, 13))
    if (node && this.h.canEdit()) {
      this.h.onSelect(node.id)
      return
    }
    // tapping the ship selects its launch impulse
    if (hits.ship && this.h.canEdit() && Math.hypot(hits.ship.x - x, hits.ship.y - y) <= Math.max(hits.ship.r, this.radius(type, 12))) {
      this.h.onSelect('launch')
      return
    }
    if (this.h.planetsInteractive()) {
      const planet = hits.planets.find((pl) => Math.hypot(pl.x - x, pl.y - y) <= Math.max(pl.r, this.radius(type, 14)))
      if (planet) {
        this.h.onTapPlanet(planet.id)
        return
      }
    }
    if (hits.path && this.h.canEdit() && this.h.canAddNode()) {
      const near = nearestOnPath(hits.path, x, y)
      if (near && near.d <= this.radius(type, 10)) this.h.onAddNode(near.t)
    }
  }

  private dragHandle(id: string, x: number, y: number): void {
    const hd = this.scene.hits.handle
    if (!hd || hd.id !== id) return
    const scale = this.h.pxPerKms() * KMS_PER_SPEED_UNIT
    // world-oriented vector (y up) from the node to the pointer
    const wx = (x - hd.ox) / scale
    const wy = -(y - hd.oy) / scale
    let prograde = wx * hd.px + wy * hd.py
    let radial = wx * hd.py - wy * hd.px
    const mag = Math.hypot(prograde, radial)
    const ang = Math.atan2(radial, prograde)
    for (const axis of [0, Math.PI / 2, -Math.PI / 2, Math.PI, -Math.PI]) {
      if (Math.abs(ang - axis) < SNAP_RAD) {
        prograde = mag * Math.cos(axis)
        radial = mag * Math.sin(axis)
      }
    }
    // 0.01 km/s steps keep plans readable and reproducible
    const step = fromKms(0.01)
    const snapped = Math.round(mag / step) * step
    const k = mag > 0 ? snapped / mag : 0
    this.h.onHandle(id, { prograde: prograde * k, radial: radial * k })
  }

  private updateHover(x: number, y: number): void {
    const hits = this.scene.hits
    const hd = hits.handle
    let hover: Hover | null = null
    if (hd && this.h.canEdit() && Math.hypot(x - hd.tx, y - hd.ty) <= 16) hover = { kind: 'handle', id: hd.id }
    else {
      const node = hits.nodes.find((n) => Math.hypot(n.x - x, n.y - y) <= 13)
      if (node && this.h.canEdit()) hover = { kind: 'node', id: node.id }
      else if (hits.path && this.h.canEdit()) {
        const near = nearestOnPath(hits.path, x, y)
        if (near && near.d <= 10) hover = { kind: 'path', t: near.t, x: near.px, y: near.py }
      }
      if (!hover && this.h.planetsInteractive()) {
        const planet = hits.planets.find((pl) => Math.hypot(pl.x - x, pl.y - y) <= Math.max(pl.r, 14))
        if (planet) hover = { kind: 'planet', id: planet.id }
      }
    }
    this.setHover(hover)
  }

  private setHover(hover: Hover | null): void {
    this.hover = hover
    if (this.drag.kind !== 'none') return
    this.canvas.style.cursor =
      hover?.kind === 'handle' ? 'grab' : hover?.kind === 'node' || hover?.kind === 'planet' ? 'pointer' : hover?.kind === 'path' && this.h.canAddNode() ? 'copy' : ''
  }
}
