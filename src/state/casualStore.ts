import { create } from 'zustand'
import { sfx } from '../game/casual/audio'
import { CASUAL_LEVELS } from '../game/casual/levels'
import { levelOpen, loadSave, storeSave, withResult, type SaveData } from '../game/casual/progress'
import type { FlightScore } from '../game/casual/scoring'
import type { Phase } from '../game/casual/session'

export type Screen = 'menu' | 'play'

/** Live flight readouts, pushed by the stage a few times a second. */
export interface Hud {
  phase: Phase
  dust: number
  /** fuel left, 0…1 of the tank */
  fuel: number
  speed: number
  charging: boolean
  failures: number
  attempts: number
}

export interface Toast {
  id: number
  title: string
  text: string
}

export interface Result {
  levelId: string
  score: FlightScore
  newBest: boolean
  newStars: number
}

/** Speed jump shown next to the speedometer after a slingshot. */
export interface Gain {
  id: number
  kms: number
}

interface CasualState {
  screen: Screen
  levelId: string
  save: SaveData
  /** `?all` in the address opens every level (testing, screenshots) */
  unlockAll: boolean
  hud: Hud
  toast: Toast | null
  gain: Gain | null
  result: Result | null
  hint: boolean
  /** bumps whenever the level should restart from aiming */
  restartTick: number

  openLevel: (id: string) => void
  toMenu: () => void
  restart: () => void
  next: () => void
  toggleMute: () => void
  toggleHint: () => void
  setHud: (hud: Partial<Hud>) => void
  showToast: (title: string, text: string) => void
  showGain: (kms: number) => void
  markLaunched: (id: string) => void
  finish: (levelId: string, score: FlightScore) => void
}

const initialSave = loadSave()
sfx.setMuted(initialSave.muted)

const freshHud = (): Hud => ({ phase: 'aim', dust: 0, fuel: 1, speed: 0, charging: false, failures: 0, attempts: 0 })

let toastId = 0

export const useCasual = create<CasualState>((set, get) => ({
  screen: 'menu',
  levelId: CASUAL_LEVELS[0].id,
  save: initialSave,
  unlockAll: typeof location !== 'undefined' && new URLSearchParams(location.search).has('all'),
  hud: freshHud(),
  toast: null,
  gain: null,
  result: null,
  hint: false,
  restartTick: 0,

  openLevel: (id) => {
    if (!levelOpen(get().save, id, get().unlockAll)) return
    set({ screen: 'play', levelId: id, hud: freshHud(), toast: null, gain: null, result: null, hint: false })
  },

  toMenu: () => set({ screen: 'menu', result: null, toast: null, gain: null }),

  restart: () => set((s) => ({ result: null, toast: null, gain: null, restartTick: s.restartTick + 1 })),

  next: () => {
    const s = get()
    const i = CASUAL_LEVELS.findIndex((l) => l.id === s.levelId)
    const nextLevel = CASUAL_LEVELS[i + 1]
    if (nextLevel && levelOpen(s.save, nextLevel.id, s.unlockAll)) s.openLevel(nextLevel.id)
    else s.toMenu()
  },

  toggleMute: () => {
    const save = { ...get().save, muted: !get().save.muted }
    sfx.setMuted(save.muted)
    storeSave(save)
    set({ save })
  },

  toggleHint: () => set((s) => ({ hint: !s.hint })),

  setHud: (hud) => {
    const cur = get().hud
    const keys = Object.keys(hud) as (keyof Hud)[]
    if (keys.every((k) => cur[k] === hud[k])) return
    set({ hud: { ...cur, ...hud } })
  },

  showToast: (title, text) => set({ toast: { id: ++toastId, title, text } }),

  showGain: (kms) => set({ gain: { id: ++toastId, kms } }),

  markLaunched: (id) => {
    const save = get().save
    if (save.launched.includes(id)) return
    const next = { ...save, launched: [...save.launched, id] }
    storeSave(next)
    set({ save: next })
  },

  finish: (levelId, score) => {
    const { save, newBest, newStars } = withResult(get().save, levelId, score.stars, score.total)
    storeSave(save)
    set({ save, result: { levelId, score, newBest, newStars }, toast: null })
  },
}))
