import type { PredictResponse } from '../game/worker/protocol'

/**
 * Latest forecast (large typed arrays). Kept outside React/Zustand: the canvas reads it every frame,
 * the store only keeps its small outcome and key.
 */
export const forecastRef: { current: PredictResponse | null } = { current: null }

/** Trajectory of the flight being played / last flown (the "ghost" of the previous attempt). */
export const flownRef: { current: PredictResponse | null } = { current: null }
export const ghostRef: { current: PredictResponse | null } = { current: null }
