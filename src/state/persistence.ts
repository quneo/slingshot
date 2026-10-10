import type { Plan } from '../game/rules/plan'

/** Bump when the stored shape changes; add a migration step below. */
export const SAVE_VERSION = 1
const KEY = 'slingshot:save'

export interface Settings {
  /** draw planets larger than their physical size (collisions still use physical radii) */
  enlargePlanets: boolean
  showGhost: boolean
  /** compare the forecast with the same flight without the slingshot planet */
  showNoAssist: boolean
  reducedMotion: boolean
  unlockAll: boolean
}

export interface AttemptSummary {
  success: boolean
  stars: number
  spentDv: number
  flightTime: number
  at: number
}

export interface LevelProgress {
  completed: boolean
  stars: number
  best: AttemptSummary | null
  attempts: AttemptSummary[]
  /** the last plan the player launched — restored when they come back, and used for the ghost path */
  lastPlan: Plan | null
}

export interface SaveData {
  version: number
  settings: Settings
  progress: Record<string, LevelProgress>
  tutorialDone: string[]
}

export const DEFAULT_SETTINGS: Settings = {
  enlargePlanets: true,
  showGhost: true,
  showNoAssist: true,
  reducedMotion: false,
  unlockAll: false,
}

export const emptyProgress = (): LevelProgress => ({ completed: false, stars: 0, best: null, attempts: [], lastPlan: null })

const prefersReducedMotion = (): boolean => {
  try {
    return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  } catch {
    return false
  }
}

export const freshSave = (): SaveData => ({
  version: SAVE_VERSION,
  settings: { ...DEFAULT_SETTINGS, reducedMotion: prefersReducedMotion() },
  progress: {},
  tutorialDone: [],
})

function migrate(raw: unknown): SaveData {
  if (!raw || typeof raw !== 'object') return freshSave()
  const data = raw as Partial<SaveData>
  if (data.version !== SAVE_VERSION) {
    // v1 is the first schema; unknown versions start fresh rather than guessing
    return freshSave()
  }
  return {
    version: SAVE_VERSION,
    settings: { ...DEFAULT_SETTINGS, ...(data.settings ?? {}) },
    progress: data.progress ?? {},
    tutorialDone: Array.isArray(data.tutorialDone) ? data.tutorialDone : [],
  }
}

export function loadSave(): SaveData {
  try {
    const text = globalThis.localStorage?.getItem(KEY)
    return text ? migrate(JSON.parse(text)) : freshSave()
  } catch {
    return freshSave()
  }
}

export function writeSave(data: SaveData): void {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(data))
  } catch {
    // storage full or blocked (private mode): progress simply is not kept
  }
}

/** Better = more stars, then less Δv, then shorter flight. */
export function isBetter(a: AttemptSummary, b: AttemptSummary | null): boolean {
  if (!b) return true
  if (a.success !== b.success) return a.success
  if (a.stars !== b.stars) return a.stars > b.stars
  if (Math.abs(a.spentDv - b.spentDv) > 1e-9) return a.spentDv < b.spentDv
  return a.flightTime < b.flightTime
}
