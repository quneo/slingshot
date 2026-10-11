import { CHAPTERS, MISSIONS } from './levels'

/** Bump when the stored shape changes. */
export const SAVE_VERSION = 1
const KEY = 'slingshot:orbits'

export interface MissionRecord {
  done: boolean
  /** best stars (0…3) */
  stars: number
  /** least total Δv a finished run took, model units (null until finished) */
  bestSpent: number | null
}

export interface SaveData {
  version: number
  missions: Record<string, MissionRecord>
  muted: boolean
  /** missions where the player has already launched at least once (the pull hint is shown until then) */
  launched: string[]
}

export const emptySave = (): SaveData => ({ version: SAVE_VERSION, missions: {}, muted: false, launched: [] })

export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return emptySave()
    const data = JSON.parse(raw) as Partial<SaveData>
    if (data.version !== SAVE_VERSION) return emptySave()
    return { ...emptySave(), ...data, missions: { ...data.missions } }
  } catch {
    return emptySave()
  }
}

export function storeSave(data: SaveData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(data))
  } catch {
    // private mode or storage full: progress lives only in this tab
  }
}

export const recordOf = (save: SaveData, id: string): MissionRecord => save.missions[id] ?? { done: false, stars: 0, bestSpent: null }

export const totalStars = (save: SaveData): number => Object.values(save.missions).reduce((s, r) => s + r.stars, 0)

export function chapterOpen(save: SaveData, chapter: number, unlockAll = false): boolean {
  const c = CHAPTERS.find((x) => x.number === chapter)
  return unlockAll || !c || totalStars(save) >= c.starsToOpen
}

/** A mission opens with its chapter, once the mission before it has been finished. */
export function missionOpen(save: SaveData, id: string, unlockAll = false): boolean {
  if (unlockAll) return true
  const i = MISSIONS.findIndex((m) => m.id === id)
  if (i < 0) return false
  if (!chapterOpen(save, MISSIONS[i].chapter)) return false
  return i === 0 || recordOf(save, MISSIONS[i - 1].id).done
}

/** Merges a finished run into the save; tells what improved. */
export function withResult(save: SaveData, id: string, stars: number, spent: number): { save: SaveData; newBest: boolean; newStars: number } {
  const prev = recordOf(save, id)
  const next: MissionRecord = {
    done: true,
    stars: Math.max(prev.stars, stars),
    bestSpent: prev.bestSpent === null ? spent : Math.min(prev.bestSpent, spent),
  }
  return {
    save: { ...save, missions: { ...save.missions, [id]: next } },
    newBest: prev.bestSpent !== null && spent < prev.bestSpent - 1e-9,
    newStars: next.stars - prev.stars,
  }
}
