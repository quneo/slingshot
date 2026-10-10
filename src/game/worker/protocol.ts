import type { PropagationResult } from '../physics/propagate'
import type { MissionOutcome } from '../rules/evaluate'
import type { Plan } from '../rules/plan'

export interface PredictRequest {
  type: 'predict'
  requestId: number
  levelId: string
  plan: Plan
}

/** The same flight without the pull of one gravity-assist planet (for comparison on the map). */
export interface NoAssistPath {
  bodyIndex: number
  /** the paths agree until the ship nears the planet: draw from here */
  tFrom: number
  samples: Float64Array
  sampleCount: number
}

export interface PredictResponse {
  type: 'predicted'
  requestId: number
  levelId: string
  planKey: string
  result: PropagationResult
  outcome: MissionOutcome
  noAssist: NoAssistPath | null
  computeMs: number
}

export interface PredictError {
  type: 'error'
  requestId: number
  message: string
}

export type WorkerResponse = PredictResponse | PredictError
