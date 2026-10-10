/// <reference lib="webworker" />
import { predict } from './predict'
import type { PredictRequest, WorkerResponse } from './protocol'

const ctx = self as unknown as DedicatedWorkerGlobalScope

ctx.onmessage = (event: MessageEvent<PredictRequest>) => {
  const req = event.data
  if (req.type !== 'predict') return
  try {
    const res = predict(req.requestId, req.levelId, req.plan)
    const transfer: ArrayBuffer[] = [res.result.samples.buffer as ArrayBuffer]
    if (res.noAssist) transfer.push(res.noAssist.samples.buffer as ArrayBuffer)
    ctx.postMessage(res satisfies WorkerResponse, transfer)
  } catch (err) {
    ctx.postMessage({ type: 'error', requestId: req.requestId, message: String(err) } satisfies WorkerResponse)
  }
}
