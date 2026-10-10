import type { PropagationResult } from '../physics/propagate'
import type { MissionOutcome } from '../rules/evaluate'
import type { Plan } from '../rules/plan'

export interface PredictRequest {
  type: 'predict'
  requestId: number
  levelId: string
  plan: Plan
}

export interface PredictResponse {
  type: 'predicted'
  requestId: number
  levelId: string
  planKey: string
  result: PropagationResult
  outcome: MissionOutcome
  computeMs: number
}

export interface PredictError {
  type: 'error'
  requestId: number
  message: string
}

export type WorkerResponse = PredictResponse | PredictError
