import { clonePlan, type Plan } from '../rules/plan'
import { predict } from './predict'
import type { PredictRequest, PredictResponse, WorkerResponse } from './protocol'

type Listener = (res: PredictResponse) => void
type ErrorListener = (message: string) => void

/**
 * Debounced, latest-wins access to the trajectory worker.
 * At most one request is in flight; while it runs only the newest plan is queued.
 * Responses older than the newest request are dropped, so a stale forecast never overwrites a fresh one.
 */
export class TrajectoryClient {
  private worker: Worker | null = null
  private nextId = 1
  private latestId = 0
  private inFlight: number | null = null
  private queued: PredictRequest | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private readonly listeners = new Set<Listener>()
  private readonly errorListeners = new Set<ErrorListener>()
  /** the request being computed, kept to recompute it on the main thread if the worker dies */
  private current: PredictRequest | null = null

  constructor(private readonly debounceMs = 24) {
    try {
      this.worker = new Worker(new URL('./trajectory.worker.ts', import.meta.url), { type: 'module' })
      this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => this.handle(e.data)
      this.worker.onerror = () => {
        // the worker failed (e.g. could not load): fall back to the main thread for this and later requests
        this.worker?.terminate()
        this.worker = null
        const lost = this.current
        this.inFlight = null
        if (lost && !this.queued) this.queued = lost
        this.flush()
      }
    } catch {
      this.worker = null
    }
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  onError(listener: ErrorListener): () => void {
    this.errorListeners.add(listener)
    return () => this.errorListeners.delete(listener)
  }

  /** Schedules a prediction; returns its request id. `immediate` skips the debounce (e.g. on level load). */
  request(levelId: string, plan: Plan, immediate = false): number {
    const req: PredictRequest = { type: 'predict', requestId: this.nextId++, levelId, plan: clonePlan(plan) }
    this.latestId = req.requestId
    this.queued = req
    if (this.timer) clearTimeout(this.timer)
    if (immediate) this.flush()
    else this.timer = setTimeout(() => this.flush(), this.debounceMs)
    return req.requestId
  }

  get latestRequestId(): number {
    return this.latestId
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer)
    this.worker?.terminate()
    this.worker = null
    this.listeners.clear()
    this.errorListeners.clear()
  }

  private flush(): void {
    this.timer = null
    if (this.inFlight !== null || !this.queued) return
    const req = this.queued
    this.queued = null
    this.current = req
    this.inFlight = req.requestId
    if (!this.worker) {
      // no worker support: compute on the main thread (same pipeline)
      queueMicrotask(() => {
        try {
          this.handle(predict(req.requestId, req.levelId, req.plan))
        } catch (err) {
          this.handle({ type: 'error', requestId: req.requestId, message: String(err) })
        }
      })
      return
    }
    this.worker.postMessage(req)
  }

  private handle(res: WorkerResponse): void {
    if (res.requestId === this.inFlight) this.inFlight = null
    if (res.type === 'predicted' && res.requestId === this.latestId) {
      for (const l of this.listeners) l(res)
    } else if (res.type === 'error') {
      console.error('Trajectory computation failed', res.message)
      if (res.requestId === this.latestId) for (const l of this.errorListeners) l(res.message)
    }
    if (this.queued) this.flush()
  }
}
