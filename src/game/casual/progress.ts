import { CASUAL_LEVELS, CHAPTERS } from './levels'

/** Bump when the stored shape changes. */
export const SAVE_VERSION = 1
const KEY = 'slingshot:casual'

export interface LevelRecord {
  done: boolean
  /** best stardust count among arrivals (0…3) */
  stars: number
  best: number
}

export interface SaveData {
  version: number
  levels: Record<string, LevelRecord>
  muted: boolean
  /** levels where the player has already launched at least once (the pull hint is shown until then) */
  launched: string[]
}

export const emptySave = (): SaveData => ({ version: SAVE_VERSION, levels: {}, muted: false, launched: [] })

export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return emptySave()
    const data = JSON.parse(raw) as Partial<SaveData>
    if (data.version !== SAVE_VERSION) return emptySave()
    return { ...emptySave(), ...data, levels: { ...data.levels } }
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

export const recordOf = (save: SaveData, id: string): LevelRecord => save.levels[id] ?? { done: false, stars: 0, best: 0 }

export const totalStars = (save: SaveData): number => Object.values(save.levels).reduce((s, r) => s + r.stars, 0)

export function chapterOpen(save: SaveData, chapter: number, unlockAll = false): boolean {
  const c = CHAPTERS.find((x) => x.number === chapter)
  return unlockAll || !c || totalStars(save) >= c.starsToOpen
}

/** A level opens with its chapter, once the level before it has been reached. */
export function levelOpen(save: SaveData, id: string, unlockAll = false): boolean {
  if (unlockAll) return true
  const i = CASUAL_LEVELS.findIndex((l) => l.id === id)
  if (i < 0) return false
  if (!chapterOpen(save, CASUAL_LEVELS[i].chapter)) return false
  return i === 0 || recordOf(save, CASUAL_LEVELS[i - 1].id).done
}

/** Merges a finished arrival into the save; tells what improved. */
export function withResult(save: SaveData, id: string, stars: number, score: number): { save: SaveData; newBest: boolean; newStars: number } {
  const prev = recordOf(save, id)
  const next: LevelRecord = { done: true, stars: Math.max(prev.stars, stars), best: Math.max(prev.best, score) }
  return {
    save: { ...save, levels: { ...save.levels, [id]: next } },
    newBest: prev.done && score > prev.best,
    newStars: next.stars - prev.stars,
  }
}
