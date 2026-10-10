import { create } from 'zustand'
import { LEVELS, getLevel } from '../game/levels/levels'
import type { LevelDef } from '../game/levels/types'
import type { MissionOutcome } from '../game/rules/evaluate'
import { clonePlan, impulseMagnitude, newNodeId, planKey, type BurnNode, type Impulse, type Plan } from '../game/rules/plan'
import { TrajectoryClient } from '../game/worker/client'
import { predict } from '../game/worker/predict'
import type { PredictResponse } from '../game/worker/protocol'
import { flightClock, type FlightSpeed } from './flightClock'
import {
  emptyProgress,
  isBetter,
  loadSave,
  writeSave,
  type AttemptSummary,
  type LevelProgress,
  type SaveData,
  type Settings,
} from './persistence'
import { flownRef, forecastRef, ghostRef } from './prediction'

export type Screen = 'menu' | 'mission'
export type Phase = 'plan' | 'flight' | 'result'
export type Selection = { kind: 'launch' } | { kind: 'node'; id: string } | null
/** auto: whole flight, closing in on each gravity assist; ship: follow the ship; system: fixed overview */
export type CameraMode = 'auto' | 'ship' | 'system'

export interface FlightReport {
  levelId: string
  outcome: MissionOutcome
  plan: Plan
  previous: AttemptSummary | null
  bestBefore: AttemptSummary | null
  isNewBest: boolean
}

interface Forecast {
  key: string | null
  outcome: MissionOutcome | null
  pending: boolean
  /** bumps on every new forecast so subscribers can redraw */
  version: number
}

export interface GameState {
  screen: Screen
  menuLevelId: string
  levelId: string
  phase: Phase
  plan: Plan
  undoStack: Plan[]
  selection: Selection
  /** planning-mode time cursor (absolute mission time) */
  viewTime: number
  forecast: Forecast
  launchQueued: boolean
  hintStep: number
  tutorialStep: number
  flight: { playing: boolean; speed: FlightSpeed; camera: CameraMode }
  report: FlightReport | null
  save: SaveData
  settingsOpen: boolean
  /** set while the player drags a handle/slider: the whole drag becomes one undo step */
  gesture: boolean
  /** increments on every launch from planning; a replay keeps it */
  flightId: number

  openMenu: (levelId?: string) => void
  selectMenuLevel: (id: string) => void
  startLevel: (id: string) => void
  setLaunchTime: (t: number) => void
  setLaunchImpulse: (impulse: Impulse) => void
  addNode: (dt: number) => string | null
  updateNode: (id: string, patch: Partial<Omit<BurnNode, 'id'>>) => void
  removeNode: (id: string) => void
  select: (sel: Selection) => void
  setViewTime: (t: number) => void
  beginGesture: () => void
  endGesture: () => void
  undo: () => void
  resetPlan: () => void
  launch: () => void
  setFlightPlaying: (playing: boolean) => void
  setFlightSpeed: (speed: FlightSpeed) => void
  setCamera: (camera: CameraMode) => void
  /** saves the attempt of the current flight (once per launch, replays are not attempts) */
  completeFlight: () => void
  /** switches a finished flight to the result screen */
  showResult: () => void
  replayFlight: () => void
  backToPlanning: () => void
  showNextHint: () => void
  advanceTutorial: (step: number) => void
  finishTutorial: () => void
  updateSettings: (patch: Partial<Settings>) => void
  setSettingsOpen: (open: boolean) => void
  resetProgress: () => void
}

let client: TrajectoryClient | null = null
function getClient(): TrajectoryClient {
  if (!client) {
    client = new TrajectoryClient()
    client.subscribe((res) => useGame.getState().__receiveForecast(res))
    client.onError(() =>
      useGame.setState((s) => ({ forecast: { ...s.forecast, pending: false }, launchQueued: false })),
    )
  }
  return client
}

export const currentLevel = (): LevelDef => getLevel(useGame.getState().levelId)

export function levelProgress(save: SaveData, id: string): LevelProgress {
  return save.progress[id] ?? emptyProgress()
}

export function isUnlocked(save: SaveData, id: string): boolean {
  if (save.settings.unlockAll) return true
  const i = LEVELS.findIndex((l) => l.id === id)
  return i <= 0 || levelProgress(save, LEVELS[i - 1].id).completed
}

/** Δv still free for one burn: budget minus all other burns. */
export function availableFor(level: LevelDef, plan: Plan, which: Selection): number {
  let others = 0
  if (!(which?.kind === 'launch')) others += impulseMagnitude(plan.launch)
  for (const n of plan.nodes) if (!(which?.kind === 'node' && which.id === n.id)) others += impulseMagnitude(n)
  return Math.max(0, level.budget - others)
}

function clampImpulse(impulse: Impulse, max: number): Impulse {
  const mag = impulseMagnitude(impulse)
  if (mag <= max || mag === 0) return impulse
  const k = max / mag
  return { prograde: impulse.prograde * k, radial: impulse.radial * k }
}

function restoredPlan(level: LevelDef, save: SaveData): Plan {
  const last = levelProgress(save, level.id).lastPlan
  return clonePlan(last ?? level.initialPlan)
}

function computeGhost(levelId: string, plan: Plan | null): void {
  ghostRef.current = plan ? predict(-1, levelId, plan) : null
}

type Internal = GameState & { __receiveForecast: (res: PredictResponse) => void; __editPlan: (fn: (p: Plan) => Plan) => void }

export const useGame = create<Internal>()((set, get) => {
  const initialSave = loadSave()
  const firstOpen = LEVELS.find((l) => !levelProgress(initialSave, l.id).completed) ?? LEVELS[0]

  const persist = (save: SaveData) => {
    writeSave(save)
    set({ save })
  }

  // undo bookkeeping for drags: the snapshot is pushed on the first real change only
  let gestureSnapshot: Plan | null = null
  let gesturePushed = false
  // the attempt of flight N is saved once, whatever happens to the result screen afterwards
  let recordedFlightId = -1

  const requestForecast = (immediate = false) => {
    const { levelId, plan } = get()
    set((s) => ({ forecast: { ...s.forecast, pending: true } }))
    getClient().request(levelId, plan, immediate)
  }

  return {
    screen: 'menu',
    menuLevelId: firstOpen.id,
    levelId: firstOpen.id,
    phase: 'plan',
    plan: clonePlan(firstOpen.initialPlan),
    undoStack: [],
    selection: null,
    viewTime: 0,
    forecast: { key: null, outcome: null, pending: false, version: 0 },
    launchQueued: false,
    hintStep: 0,
    tutorialStep: 0,
    flight: { playing: false, speed: 10, camera: 'auto' },
    report: null,
    save: initialSave,
    settingsOpen: false,
    gesture: false,
    flightId: 0,

    __receiveForecast: (res) => {
      const s = get()
      if (res.levelId !== s.levelId) return
      forecastRef.current = res
      const fresh = res.planKey === planKey(s.plan)
      set({
        forecast: { key: res.planKey, outcome: res.outcome, pending: !fresh, version: s.forecast.version + 1 },
      })
      if (fresh && s.launchQueued) {
        set({ launchQueued: false })
        get().launch()
      }
    },

    __editPlan: (fn) => {
      const s = get()
      if (s.phase !== 'plan') return
      const before = s.plan
      const plan = fn(clonePlan(before))
      if (planKey(plan) === planKey(before)) return
      let undoStack = s.undoStack
      if (!s.gesture) undoStack = [...undoStack.slice(-49), before]
      else if (!gesturePushed && gestureSnapshot) {
        undoStack = [...undoStack.slice(-49), gestureSnapshot]
        gesturePushed = true
      }
      // any edit cancels a launch that was waiting for the previous forecast
      set({ plan, undoStack, launchQueued: false })
      requestForecast()
    },

    openMenu: (levelId) => {
      flightClock.playing = false
      set({ screen: 'menu', menuLevelId: levelId ?? get().levelId, settingsOpen: false, launchQueued: false, gesture: false })
    },

    selectMenuLevel: (id) => set({ menuLevelId: id }),

    startLevel: (id) => {
      const level = getLevel(id)
      const save = get().save
      const plan = restoredPlan(level, save)
      forecastRef.current = null
      flownRef.current = null
      flightClock.playing = false
      set({
        screen: 'mission',
        levelId: id,
        menuLevelId: id,
        phase: 'plan',
        plan,
        undoStack: [],
        selection: { kind: 'launch' },
        viewTime: plan.launchTime,
        forecast: { key: null, outcome: null, pending: true, version: get().forecast.version + 1 },
        launchQueued: false,
        gesture: false,
        hintStep: 0,
        tutorialStep: save.tutorialDone.includes(id) ? Number.POSITIVE_INFINITY : 0,
        report: null,
      })
      computeGhost(id, levelProgress(save, id).lastPlan)
      requestForecast(true)
    },

    setLaunchTime: (t) => {
      const level = currentLevel()
      const [w0, w1] = level.start.launchWindow
      const launchTime = Math.min(w1, Math.max(w0, t))
      get().__editPlan((p) => ({ ...p, launchTime }))
      set({ viewTime: launchTime })
    },

    setLaunchImpulse: (impulse) => {
      const level = currentLevel()
      get().__editPlan((p) => ({ ...p, launch: clampImpulse(impulse, availableFor(level, p, { kind: 'launch' })) }))
    },

    addNode: (dt) => {
      const level = currentLevel()
      const s = get()
      if (s.phase !== 'plan' || 1 + s.plan.nodes.length >= level.maxBurns) return null
      const id = newNodeId()
      const clamped = Math.min(level.horizon - 0.01, Math.max(0.02, dt))
      get().__editPlan((p) => ({ ...p, nodes: [...p.nodes, { id, dt: clamped, prograde: 0, radial: 0 }] }))
      set({ selection: { kind: 'node', id }, viewTime: get().plan.launchTime + clamped })
      return id
    },

    updateNode: (id, patch) => {
      const level = currentLevel()
      get().__editPlan((p) => ({
        ...p,
        nodes: p.nodes.map((n) => {
          if (n.id !== id) return n
          const next = { ...n, ...patch }
          next.dt = Math.min(level.horizon - 0.01, Math.max(0.02, next.dt))
          const limited = clampImpulse(next, availableFor(level, p, { kind: 'node', id }))
          return { ...next, ...limited }
        }),
      }))
    },

    removeNode: (id) => {
      get().__editPlan((p) => ({ ...p, nodes: p.nodes.filter((n) => n.id !== id) }))
      const sel = get().selection
      if (sel?.kind === 'node' && sel.id === id) set({ selection: { kind: 'launch' } })
    },

    select: (selection) => set({ selection }),
    setViewTime: (t) => set({ viewTime: t }),

    beginGesture: () => {
      const s = get()
      if (s.gesture) return
      gestureSnapshot = clonePlan(s.plan)
      gesturePushed = false
      set({ gesture: true })
    },
    endGesture: () => {
      gestureSnapshot = null
      gesturePushed = false
      set({ gesture: false })
    },

    undo: () => {
      const s = get()
      if (s.phase !== 'plan' || s.undoStack.length === 0) return
      const plan = s.undoStack[s.undoStack.length - 1]
      const sel = s.selection
      const selectionValid = sel?.kind !== 'node' || plan.nodes.some((n) => n.id === sel.id)
      set({ plan, undoStack: s.undoStack.slice(0, -1), selection: selectionValid ? sel : { kind: 'launch' }, launchQueued: false })
      requestForecast()
    },

    resetPlan: () => {
      const level = currentLevel()
      get().__editPlan(() => clonePlan(level.initialPlan))
      set({ selection: { kind: 'launch' }, viewTime: level.initialPlan.launchTime })
    },

    launch: () => {
      const s = get()
      if (s.phase !== 'plan') return
      const fc = forecastRef.current
      if (!fc || fc.planKey !== planKey(s.plan) || fc.levelId !== s.levelId) {
        set({ launchQueued: true })
        requestForecast(true)
        return
      }
      flownRef.current = fc
      flightClock.reset(fc.result.samples[0], fc.result.endTime)
      set({
        phase: 'flight',
        selection: null,
        flight: { ...s.flight, playing: true },
        launchQueued: false,
        flightId: s.flightId + 1,
        gesture: false,
      })
      // the launch itself completes the "launch" tutorial step
      const tut = getLevel(s.levelId).tutorial ?? []
      const idx = tut.indexOf('launch')
      if (idx >= 0 && s.tutorialStep <= idx) get().finishTutorial()
    },

    setFlightPlaying: (playing) => {
      if (playing && flightClock.finished) flightClock.seek(flightClock.startTime)
      flightClock.playing = playing
      set((s) => ({ flight: { ...s.flight, playing } }))
    },

    setFlightSpeed: (speed) => {
      flightClock.speed = speed
      set((s) => ({ flight: { ...s.flight, speed } }))
    },

    setCamera: (camera) => set((s) => ({ flight: { ...s.flight, camera } })),

    completeFlight: () => {
      const s = get()
      const flown = flownRef.current
      if (!flown || s.phase !== 'flight' || recordedFlightId === s.flightId) return
      recordedFlightId = s.flightId
      const outcome = flown.outcome
      const prog = levelProgress(s.save, s.levelId)
      const attempt: AttemptSummary = {
        success: outcome.success,
        stars: outcome.stars,
        spentDv: outcome.spentDv,
        flightTime: outcome.flightTime,
        at: Date.now(),
      }
      const isNewBest = outcome.success && isBetter(attempt, prog.best)
      const nextProg: LevelProgress = {
        completed: prog.completed || outcome.success,
        stars: Math.max(prog.stars, outcome.stars),
        best: isNewBest ? attempt : prog.best,
        attempts: [...prog.attempts.slice(-9), attempt],
        lastPlan: clonePlan(s.plan),
      }
      persist({ ...s.save, progress: { ...s.save.progress, [s.levelId]: nextProg } })
      ghostRef.current = flown
      set({
        report: {
          levelId: s.levelId,
          outcome,
          plan: clonePlan(s.plan),
          previous: prog.attempts[prog.attempts.length - 1] ?? null,
          bestBefore: prog.best,
          isNewBest,
        },
      })
    },

    showResult: () => {
      if (get().phase !== 'flight') return
      get().completeFlight()
      const s = get()
      set({ phase: 'result', flight: { ...s.flight, playing: false } })
    },

    replayFlight: () => {
      const fc = flownRef.current
      if (!fc) return
      flightClock.reset(fc.result.samples[0], fc.result.endTime)
      set((s) => ({ phase: 'flight', flight: { ...s.flight, playing: true } }))
    },

    backToPlanning: () => {
      // leaving a flight that already reached its end still counts as an attempt
      if (get().phase === 'flight' && flightClock.finished) get().completeFlight()
      flightClock.playing = false
      const s = get()
      set({
        phase: 'plan',
        selection: { kind: 'launch' },
        viewTime: s.plan.launchTime,
        flight: { ...s.flight, playing: false },
        launchQueued: false,
      })
    },

    showNextHint: () => set((s) => ({ hintStep: Math.min(3, s.hintStep + 1) })),

    advanceTutorial: (step) => set((s) => ({ tutorialStep: Math.max(s.tutorialStep, step) })),

    finishTutorial: () => {
      const s = get()
      set({ tutorialStep: Number.POSITIVE_INFINITY })
      if (!s.save.tutorialDone.includes(s.levelId))
        persist({ ...s.save, tutorialDone: [...s.save.tutorialDone, s.levelId] })
    },

    updateSettings: (patch) => {
      const s = get()
      persist({ ...s.save, settings: { ...s.save.settings, ...patch } })
    },

    setSettingsOpen: (settingsOpen) => set({ settingsOpen }),

    resetProgress: () => {
      const s = get()
      persist({ ...s.save, progress: {}, tutorialDone: [] })
      ghostRef.current = null
      set({ menuLevelId: LEVELS[0].id })
    },
  }
})

