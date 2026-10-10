import { clonePlan, type Plan } from '../rules/plan'
import { predict } from './predict'
import type { PredictRequest, PredictResponse, WorkerResponse } from './protocol'

type Listener = (res: PredictResponse) => void

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

  constructor(private readonly debounceMs = 24) {
    try {
      this.worker = new Worker(new URL('./trajectory.worker.ts', import.meta.url), { type: 'module' })
      this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => this.handle(e.data)
      this.worker.onerror = () => {
        this.worker = null
      }
    } catch {
      this.worker = null
    }
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
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
  }

  private flush(): void {
    this.timer = null
    if (this.inFlight !== null || !this.queued) return
    const req = this.queued
    this.queued = null
    if (!this.worker) {
      // no worker support: compute on the main thread (same pipeline)
      queueMicrotask(() => this.handle(predict(req.requestId, req.levelId, req.plan)))
      this.inFlight = req.requestId
      return
    }
    this.inFlight = req.requestId
    this.worker.postMessage(req)
  }

  private handle(res: WorkerResponse): void {
    if (res.requestId === this.inFlight) this.inFlight = null
    if (res.type === 'predicted' && res.requestId === this.latestId) {
      for (const l of this.listeners) l(res)
    } else if (res.type === 'error') {
      console.error('Trajectory worker error', res.message)
    }
    if (this.queued) this.flush()
  }
}
