import { clonePlan, type Plan } from '../rules/plan'
import { predict } from './predict'
import type { PredictRequest, PredictResponse, WorkerResponse } from './protocol'

type Listener = (res: PredictResponse) => void
type ErrorListener = (message: string) => void

/**
 * Latest-wins access to the trajectory worker, paced by the worker itself.
 * A request goes out at once if the worker is idle; while one is in flight only the newest plan waits, and it is
 * sent the moment the answer comes back. A drag therefore updates the forecast as fast as it can be computed
 * (every frame for these levels) — no debounce that would starve while the pointer keeps moving.
 * Responses older than the newest request are dropped, so a stale forecast never overwrites a fresh one.
 */
export class TrajectoryClient {
  private worker: Worker | null = null
  private nextId = 1
  private latestId = 0
  private inFlight: number | null = null
  private queued: PredictRequest | null = null
  private readonly listeners = new Set<Listener>()
  private readonly errorListeners = new Set<ErrorListener>()
  /** the request being computed, kept to recompute it on the main thread if the worker dies */
  private current: PredictRequest | null = null

  constructor() {
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

  /** Schedules a prediction (replacing any not-yet-sent one); returns its request id. */
  request(levelId: string, plan: Plan): number {
    const req: PredictRequest = { type: 'predict', requestId: this.nextId++, levelId, plan: clonePlan(plan) }
    this.latestId = req.requestId
    this.queued = req
    this.flush()
    return req.requestId
  }

  get latestRequestId(): number {
    return this.latestId
  }

  dispose(): void {
    this.worker?.terminate()
    this.worker = null
    this.listeners.clear()
    this.errorListeners.clear()
  }

  private flush(): void {
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
