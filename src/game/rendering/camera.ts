/** World (model units, y up) ↔ screen (CSS px, y down). */

export interface Insets {
  top: number
  right: number
  bottom: number
  left: number
}

export interface CameraView {
  x: number
  y: number
  /** CSS px per model length unit */
  zoom: number
}

export class Camera {
  x = 0
  y = 0
  zoom = 120
  width = 1
  height = 1
  insets: Insets = { top: 0, right: 0, bottom: 0, left: 0 }
  private target: CameraView | null = null
  /** approach speed of the current animation, 1/s */
  private rate = 7
  /** bumps when the user moves the camera by hand (follow modes give up then) */
  manualVersion = 0

  readonly minZoom = 8
  readonly maxZoom = 6000

  resize(width: number, height: number): void {
    this.width = Math.max(1, width)
    this.height = Math.max(1, height)
  }

  sx(wx: number): number {
    return this.width / 2 + (wx - this.x) * this.zoom
  }

  sy(wy: number): number {
    return this.height / 2 - (wy - this.y) * this.zoom
  }

  toWorld(sx: number, sy: number): { x: number; y: number } {
    return { x: this.x + (sx - this.width / 2) / this.zoom, y: this.y - (sy - this.height / 2) / this.zoom }
  }

  /** View that shows a circle of `radius` around (cx, cy) inside the area not covered by UI insets. */
  fitView(cx: number, cy: number, radius: number): CameraView {
    const { top, right, bottom, left } = this.insets
    const w = Math.max(80, this.width - left - right)
    const h = Math.max(80, this.height - top - bottom)
    const zoom = Math.min(this.maxZoom, Math.max(this.minZoom, Math.min(w, h) / (2 * radius)))
    // shift the camera so that the circle is centred in the free area, not in the full canvas
    const offX = (left - right) / 2 / zoom
    const offY = (bottom - top) / 2 / zoom
    return { x: cx - offX, y: cy - offY, zoom }
  }

  fit(cx: number, cy: number, radius: number, animate = true): void {
    const v = this.fitView(cx, cy, radius)
    if (animate) this.animateTo(v)
    else this.set(v)
  }

  set(v: CameraView): void {
    this.x = v.x
    this.y = v.y
    this.zoom = v.zoom
    this.target = null
  }

  animateTo(v: CameraView, rate = 7): void {
    this.target = v
    this.rate = rate
  }

  get animating(): boolean {
    return this.target !== null
  }

  pan(dxPx: number, dyPx: number): void {
    this.x -= dxPx / this.zoom
    this.y += dyPx / this.zoom
    this.target = null
    this.manualVersion++
  }

  zoomAt(sx: number, sy: number, factor: number): void {
    const before = this.toWorld(sx, sy)
    this.zoom = Math.min(this.maxZoom, Math.max(this.minZoom, this.zoom * factor))
    const after = this.toWorld(sx, sy)
    this.x += before.x - after.x
    this.y += before.y - after.y
    this.target = null
    this.manualVersion++
  }

  /** Exponential approach to the animation target; frame-rate independent. */
  update(dtSeconds: number): void {
    if (!this.target) return
    const k = 1 - Math.exp(-dtSeconds * this.rate)
    const t = this.target
    this.x += (t.x - this.x) * k
    this.y += (t.y - this.y) * k
    // zoom in log space so wide zoom changes feel even
    this.zoom = Math.exp(Math.log(this.zoom) + (Math.log(t.zoom) - Math.log(this.zoom)) * k)
    if (Math.abs(t.x - this.x) * this.zoom < 0.3 && Math.abs(t.y - this.y) * this.zoom < 0.3 && Math.abs(t.zoom / this.zoom - 1) < 0.002) {
      this.set(t)
    }
  }
}
