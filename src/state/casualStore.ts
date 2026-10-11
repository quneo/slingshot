import { create } from 'zustand'
import { sfx } from '../game/casual/audio'
import { MISSIONS } from '../game/casual/levels'
import { loadSave, missionOpen, storeSave, withResult, type SaveData } from '../game/casual/progress'
import type { Spending } from '../game/casual/scoring'
import type { Phase } from '../game/casual/session'

export type Screen = 'menu' | 'play'

/** What the aiming forecast says about the hop right now. */
export interface ForecastHud {
  /** Δv of the throw, model units */
  launch: number
  /** Δv the capture would take; null when the forecast misses the target */
  capture: number | null
  /** launch + capture, rounded once (null on a miss) */
  total: number | null
  /** launch + capture compared with the reference hop: ≤ 1.1 is a window */
  ratio: number | null
  affordable: boolean
}

/** Live readouts, pushed by the stage a few times a second. */
export interface Hud {
  phase: Phase
  hopIndex: number
  /** fuel left, model units */
  fuel: number
  /** mission day */
  day: number
  speed: number
  charging: boolean
  failures: number
  forecast: ForecastHud | null
}

export interface Toast {
  id: number
  title: string
  text: string
}

export interface Result {
  missionId: string
  stars: number
  spent: number
  spending: Spending
  /** Δv each hop took */
  hops: number[]
  days: number
  newBest: boolean
  newStars: number
}

/** Launch windows ahead, for the chart under the tank (km/s per sample, days). */
export interface Chart {
  key: string
  costs: number[]
  startDay: number
  spanDays: number
}

/** Speed jump shown next to the speedometer after a slingshot, or a capture's price. */
export interface Gain {
  id: number
  kms: number
}

interface CasualState {
  screen: Screen
  levelId: string
  save: SaveData
  /** `?all` in the address opens every mission (testing, screenshots) */
  unlockAll: boolean
  hud: Hud
  toast: Toast | null
  gain: Gain | null
  result: Result | null
  hint: boolean
  /** held ⏩: the parked clock runs fast */
  fastForward: boolean
  chart: Chart | null
  /** bump to retry the current hop / the whole mission */
  restartTick: number
  missionTick: number

  openLevel: (id: string) => void
  toMenu: () => void
  restart: () => void
  restartMission: () => void
  next: () => void
  toggleMute: () => void
  toggleHint: () => void
  setFastForward: (on: boolean) => void
  setHud: (hud: Partial<Hud>) => void
  showToast: (title: string, text: string) => void
  showGain: (kms: number) => void
  markLaunched: (id: string) => void
  finish: (result: Omit<Result, 'newBest' | 'newStars'>) => void
}

const initialSave = loadSave()
sfx.setMuted(initialSave.muted)

const freshHud = (): Hud => ({ phase: 'parked', hopIndex: 0, fuel: 0, day: 0, speed: 0, charging: false, failures: 0, forecast: null })

let toastId = 0

export const useCasual = create<CasualState>((set, get) => ({
  screen: 'menu',
  levelId: MISSIONS[0].id,
  save: initialSave,
  unlockAll: typeof location !== 'undefined' && new URLSearchParams(location.search).has('all'),
  hud: freshHud(),
  toast: null,
  gain: null,
  result: null,
  hint: false,
  fastForward: false,
  chart: null,
  restartTick: 0,
  missionTick: 0,

  openLevel: (id) => {
    if (!missionOpen(get().save, id, get().unlockAll)) return
    set({ screen: 'play', levelId: id, hud: freshHud(), toast: null, gain: null, result: null, hint: false, fastForward: false, chart: null })
  },

  toMenu: () => set({ screen: 'menu', result: null, toast: null, gain: null, fastForward: false }),

  restart: () => set((s) => ({ result: null, toast: null, gain: null, restartTick: s.restartTick + 1 })),

  restartMission: () => set((s) => ({ result: null, toast: null, gain: null, missionTick: s.missionTick + 1 })),

  next: () => {
    const s = get()
    const i = MISSIONS.findIndex((m) => m.id === s.levelId)
    const nextMission = MISSIONS[i + 1]
    if (nextMission && missionOpen(s.save, nextMission.id, s.unlockAll)) s.openLevel(nextMission.id)
    else s.toMenu()
  },

  toggleMute: () => {
    const save = { ...get().save, muted: !get().save.muted }
    sfx.setMuted(save.muted)
    storeSave(save)
    set({ save })
  },

  toggleHint: () => set((s) => ({ hint: !s.hint })),

  setFastForward: (on) => {
    if (get().fastForward !== on) set({ fastForward: on })
  },

  setHud: (hud) => {
    const cur = get().hud
    const keys = Object.keys(hud) as (keyof Hud)[]
    if (keys.every((k) => (k === 'forecast' ? sameForecast(cur.forecast, hud.forecast ?? null) : cur[k] === hud[k]))) return
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

  finish: (r) => {
    const { save, newBest, newStars } = withResult(get().save, r.missionId, r.stars, r.spent)
    storeSave(save)
    set({ save, result: { ...r, newBest, newStars }, toast: null, fastForward: false })
  },
}))

function sameForecast(a: ForecastHud | null, b: ForecastHud | null): boolean {
  if (!a || !b) return a === b
  return a.launch === b.launch && a.capture === b.capture && a.total === b.total && a.ratio === b.ratio && a.affordable === b.affordable
}
