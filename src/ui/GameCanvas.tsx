import { useEffect, useRef, useState } from 'react'
import { Interaction } from '../game/controls/interaction'
import { LEVELS, getLevel } from '../game/levels/levels'
import { buildMissionSystem, type MissionSystem } from '../game/levels/mission'
import type { LevelDef } from '../game/levels/types'
import { newSample, sampleTrajectory, SAMPLE_STRIDE } from '../game/physics/interpolate'
import { bodyState } from '../game/physics/system'
import { fromDays, toKms } from '../game/physics/units'
import { loadAssets } from '../game/rendering/assets'
import type { Insets } from '../game/rendering/camera'
import { Scene, type MenuMarker, type SceneFrame } from '../game/rendering/scene'
import { flightClock } from '../state/flightClock'
import { availableFor, isUnlocked, levelProgress, useGame, type CameraMode } from '../state/gameStore'
import { flownRef, forecastRef, ghostRef } from '../state/prediction'
import type { PredictResponse } from '../game/worker/protocol'
import { sceneBridge } from './sceneBridge'

/** Menu backdrop: the level that shows the most of the system (every planet). */
const SHOWCASE = LEVELS.reduce((best, l) => (l.bodies.length > best.bodies.length ? l : best))
const MENU_TARGETS: Record<string, MenuMarker['bodyId']> = { L1: 'rubra', L2: 'colossus', L3: 'aurum', L4: 'aqua', L5: 'viola', L6: 'rubra' }

const missionCache = new Map<string, MissionSystem>()
function missionOf(level: LevelDef): MissionSystem {
  let m = missionCache.get(level.id)
  if (!m) {
    m = buildMissionSystem(level)
    missionCache.set(level.id, m)
  }
  return m
}

export const isCompactViewport = () => window.matchMedia('(max-width: 767px)').matches

/** Length of the Δv handle per km/s: the whole budget spans ~150 px (≈115 px on phones). */
export function handleScale(level: LevelDef): number {
  return (isCompactViewport() ? 115 : 150) / toKms(level.budget)
}

/** HUD panels that cover the map, measured from the DOM; the camera frames the free area. */
function measureInsets(): Insets {
  const w = window.innerWidth
  const h = window.innerHeight
  const ins: Insets = { top: 0, right: 0, bottom: 0, left: 0 }
  document.querySelectorAll<HTMLElement>('[data-inset]').forEach((el) => {
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) return
    switch (el.dataset.inset) {
      case 'left':
        ins.left = Math.max(ins.left, r.right)
        break
      case 'right':
        ins.right = Math.max(ins.right, w - r.left)
        break
      case 'top':
        ins.top = Math.max(ins.top, r.bottom)
        break
      case 'bottom':
        ins.bottom = Math.max(ins.bottom, h - r.top)
        break
    }
  })
  // never let panels squeeze the map to nothing
  ins.left = Math.min(ins.left, w * 0.45)
  ins.bottom = Math.min(ins.bottom, h * 0.55)
  return ins
}

function trajectoryBounds(fc: PredictResponse): { x: number; y: number; r: number } {
  const s = fc.result.samples
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (let i = 0; i < fc.result.sampleCount; i++) {
    const x = s[i * SAMPLE_STRIDE + 1]
    const y = s[i * SAMPLE_STRIDE + 2]
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
    minY = Math.min(minY, y)
    maxY = Math.max(maxY, y)
  }
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2, r: Math.max(0.6, Math.max(maxX - minX, maxY - minY) / 2 + 0.35) }
}

function thrustAt(fc: PredictResponse, level: LevelDef, t: number): number {
  const window = fromDays(9)
  let th = 0
  const start = fc.result.samples[0]
  if (level.start.kind === 'docked' && t >= start) th = Math.max(th, 1 - (t - start) / window)
  for (const b of fc.result.burns) {
    if (b.applied && b.magnitude > 1e-9 && t >= b.t) th = Math.max(th, 1 - (t - b.t) / window)
  }
  return Math.max(0, th)
}

export function GameCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current!
    let disposed = false
    let raf = 0
    let interaction: Interaction | null = null
    let resizeObs: ResizeObserver | null = null

    loadAssets()
      .then(async (assets) => {
        await document.fonts?.ready
        if (disposed) return
        const scene = new Scene(canvas, assets)
        sceneBridge.scene = scene
        setReady(true)
        const tmp = newSample()

        const resize = () => {
          const parent = canvas.parentElement!
          scene.resize(parent.clientWidth, parent.clientHeight, window.devicePixelRatio || 1)
        }
        resize()
        resizeObs = new ResizeObserver(resize)
        resizeObs.observe(canvas.parentElement!)

        interaction = new Interaction(canvas, scene, {
          canEdit: () => {
            const s = useGame.getState()
            return s.screen === 'mission' && s.phase === 'plan'
          },
          canAddNode: () => {
            const s = useGame.getState()
            return 1 + s.plan.nodes.length < getLevel(s.levelId).maxBurns
          },
          pxPerKms: () => handleScale(getLevel(useGame.getState().levelId)),
          onSelect: (id) => useGame.getState().select(id === 'launch' ? { kind: 'launch' } : { kind: 'node', id }),
          onHandle: (id, impulse) => {
            const s = useGame.getState()
            if (id === 'launch') s.setLaunchImpulse(impulse)
            else s.updateNode(id, impulse)
          },
          onAddNode: (t) => {
            const s = useGame.getState()
            s.addNode(t - s.plan.launchTime)
          },
          onGestureStart: () => useGame.getState().beginGesture(),
          onGestureEnd: () => useGame.getState().endGesture(),
          planetsInteractive: () => useGame.getState().screen === 'menu',
          onTapPlanet: (key) => {
            // a mission badge carries its level id; a bare planet opens the first mission that targets it
            const levelId = LEVELS.some((l) => l.id === key)
              ? key
              : Object.entries(MENU_TARGETS).find(([, body]) => body === key)?.[0]
            if (levelId) useGame.getState().selectMenuLevel(levelId)
          },
        })

        // camera framing state
        let fitKey = ''
        let pendingFit = 0
        let menuTime = 0
        let insetsAt = 0
        let finishTimer: ReturnType<typeof setTimeout> | null = null
        let cameraMode = ''
        let manualSeen = 0
        let introDone = false

        const overview = (fc: PredictResponse, level: LevelDef) => {
          const b = trajectoryBounds(fc)
          return scene.camera.fitView(b.x, b.y, Math.max(b.r, level.camera.radius * 0.6))
        }

        const fitCurrent = (animate = true) => {
          const s = useGame.getState()
          if (s.screen === 'menu') {
            // the very first framing is a slow fly-in, later returns to the map are quick
            scene.camera.animateTo(scene.camera.fitView(0, 0, 8.1), introDone || s.save.settings.reducedMotion ? 7 : 1.4)
            introDone = true
            if (!animate) scene.camera.set(scene.camera.fitView(0, 0, 8.1))
            return
          }
          const level = getLevel(s.levelId)
          const fc = s.phase === 'plan' ? null : flownRef.current
          if (fc && s.phase === 'flight' && s.flight.camera === 'ship') {
            const p = sampleTrajectory(fc.result.samples, fc.result.sampleCount, flightClock.time, tmp)
            scene.camera.animateTo(scene.camera.fitView(p.x, p.y, 1.1))
          } else if (fc) {
            scene.camera.animateTo(overview(fc, level))
          } else {
            scene.camera.fit(level.camera.x, level.camera.y, level.camera.radius, animate)
          }
        }

        /** Shows the result a moment after arrival — only for the flight that arrived, if it is still on screen. */
        const scheduleResult = (flightId: number) => {
          if (finishTimer) clearTimeout(finishTimer)
          finishTimer = setTimeout(() => {
            finishTimer = null
            const st = useGame.getState()
            if (st.phase === 'flight' && st.flightId === flightId && flightClock.finished) st.showResult()
          }, 1100)
        }
        sceneBridge.refit = () => fitCurrent(true)
        sceneBridge.anchor = (key) => {
          const s = useGame.getState()
          if (s.screen !== 'mission') return null
          const level = getLevel(s.levelId)
          const hits = scene.hits
          const planet = (id: string | undefined) => {
            const p = id ? hits.planets.find((pl) => pl.id === id) : undefined
            return p ? { x: p.x, y: p.y, r: p.r } : null
          }
          switch (key) {
            case 'home':
              return level.start.kind === 'docked' ? planet(level.start.bodyId) : hits.ship
            case 'target':
              return planet(level.target.bodyId)
            case 'helper':
              return planet(level.hintBody && level.hintBody !== level.target.bodyId ? level.hintBody : level.target.bodyId)
            case 'ship':
              return hits.ship
            case 'handle': {
              const h = hits.handle
              if (!h) return null
              const len = Math.hypot(h.tx - h.ox, h.ty - h.oy)
              // with no impulse yet, show pulling forward along the motion
              const dir = len > 4 ? { x: (h.tx - h.ox) / len, y: (h.ty - h.oy) / len } : { x: h.px, y: -h.py }
              return { x: h.tx, y: h.ty, r: 14, dir }
            }
            case 'path': {
              const p = hits.path
              if (!p || p.n < 4) return null
              const i = Math.floor(p.n * 0.22)
              return { x: p.xs[i], y: p.ys[i], r: 12 }
            }
          }
        }
        sceneBridge.focusShip = () => {
          const s = useGame.getState()
          const fc = s.phase === 'plan' ? forecastRef.current : flownRef.current
          if (!fc) return
          const t = s.phase === 'plan' ? s.viewTime : flightClock.time
          const p = sampleTrajectory(fc.result.samples, fc.result.sampleCount, t, tmp)
          scene.camera.animateTo(scene.camera.fitView(p.x, p.y, 0.8))
        }

        /** Flight camera: follow the ship, hold the overview, or (auto) close in on each gravity assist. */
        const steerFlightCamera = (mode: CameraMode, fc: PredictResponse, level: LevelDef, time: number) => {
          const cam = scene.camera
          if (mode !== cameraMode) manualSeen = cam.manualVersion
          if (mode === 'ship') {
            const p = sampleTrajectory(fc.result.samples, fc.result.sampleCount, time, tmp)
            if (cameraMode !== 'ship') cam.animateTo(cam.fitView(p.x, p.y, 1.1))
            else if (!cam.animating) cam.set({ ...cam.fitView(p.x, p.y, 1), zoom: cam.zoom })
            return
          }
          if (mode === 'system') {
            if (cameraMode !== 'system' && cameraMode !== '') cam.animateTo(overview(fc, level))
            return
          }
          // auto: the player grabbing the map takes over (switch to the fixed overview)
          if (cam.manualVersion !== manualSeen) {
            useGame.getState().setCamera('system')
            return
          }
          const mission = missionOf(level)
          const fb = fc.result.flybys.find((f) => {
            const pad = (f.tOut - f.tIn) * 0.35
            return time >= f.tIn - pad && time <= f.tOut + pad
          })
          if (fb) {
            const p = sampleTrajectory(fc.result.samples, fc.result.sampleCount, time, tmp)
            const pl = bodyState(mission.system, fb.bodyIndex, time)
            const infl = mission.system.bodies[fb.bodyIndex].influenceRadius
            const d = Math.hypot(p.x - pl.x, p.y - pl.y)
            const radius = Math.max(infl * 1.15, d * 0.6 + infl * 0.5)
            cam.animateTo(cam.fitView((p.x + pl.x * 2) / 3, (p.y + pl.y * 2) / 3, radius), 2.2)
          } else {
            cam.animateTo(overview(fc, level), 2.2)
          }
          manualSeen = cam.manualVersion
        }

        let last = performance.now()
        const frame = (now: number) => {
          raf = requestAnimationFrame(frame)
          const dt = Math.min(0.1, (now - last) / 1000)
          last = now
          const s = useGame.getState()
          const calm = s.save.settings.reducedMotion

          if (now - insetsAt > 300) {
            insetsAt = now
            scene.camera.insets = measureInsets()
          }

          const key = s.screen === 'menu' ? 'menu' : `${s.levelId}:${s.phase}`
          if (key !== fitKey) {
            // wait a few frames so the new screen's panels are laid out before measuring them
            fitKey = key
            pendingFit = 3
          }
          if (pendingFit > 0 && --pendingFit === 0) {
            scene.camera.insets = measureInsets()
            insetsAt = now
            fitCurrent(true)
          }

          let frameData: SceneFrame
          if (s.screen === 'menu') {
            if (!calm) menuTime += dt * 0.12
            const markers: MenuMarker[] = LEVELS.map((l) => ({
              levelId: l.id,
              levelNumber: l.number,
              bodyId: MENU_TARGETS[l.id],
              locked: !isUnlocked(s.save, l.id),
              stars: levelProgress(s.save, l.id).stars,
              selected: l.id === s.menuLevelId,
            }))
            frameData = {
              mode: 'menu',
              level: SHOWCASE,
              mission: missionOf(SHOWCASE),
              time: menuTime,
              plan: SHOWCASE.initialPlan,
              forecast: null,
              flown: null,
              ghost: null,
              showGhost: false,
              showNoAssist: false,
              selection: null,
              enlarge: true,
              calm,
              hover: interaction?.hover ?? null,
              hintBody: null,
              pxPerKms: 1,
              availableDv: 0,
              canAddNode: false,
              menuMarkers: markers,
              thrust: 0,
            }
          } else {
            const level = getLevel(s.levelId)
            let time = s.viewTime
            let thrust = 0
            if (s.phase !== 'flight' && finishTimer) {
              clearTimeout(finishTimer)
              finishTimer = null
            }
            if (s.phase !== 'plan') {
              if (s.phase === 'flight' && flightClock.advance(dt)) {
                // the attempt counts the moment the ship arrives, whatever the player does next
                s.completeFlight()
                scheduleResult(s.flightId)
              }
              time = flightClock.time
              const fc = flownRef.current
              if (fc) {
                thrust = thrustAt(fc, level, time)
                if (s.phase === 'flight') steerFlightCamera(s.flight.camera, fc, level, time)
              }
              // read the store again: steering may have just switched the mode (manual takeover)
              cameraMode = s.phase === 'flight' ? useGame.getState().flight.camera : ''
            } else {
              cameraMode = ''
            }
            frameData = {
              mode: s.phase,
              level,
              mission: missionOf(level),
              time,
              plan: s.plan,
              forecast: forecastRef.current?.levelId === level.id ? forecastRef.current : null,
              flown: flownRef.current,
              ghost: ghostRef.current?.levelId === level.id ? ghostRef.current : null,
              showGhost: s.save.settings.showGhost,
              showNoAssist: s.save.settings.showNoAssist,
              selection: s.selection,
              enlarge: s.save.settings.enlargePlanets,
              calm,
              hover: interaction?.hover ?? null,
              hintBody: s.hintStep >= 2 ? (level.hintBody ?? null) : null,
              pxPerKms: handleScale(level),
              availableDv: availableFor(level, s.plan, s.selection),
              canAddNode: 1 + s.plan.nodes.length < level.maxBurns,
              thrust,
            }
          }
          scene.camera.update(dt)
          scene.render(frameData, now / 1000)
        }
        raf = requestAnimationFrame(frame)
      })
      .catch((err: unknown) => setFailed(String(err)))

    return () => {
      disposed = true
      cancelAnimationFrame(raf)
      interaction?.dispose()
      resizeObs?.disconnect()
      sceneBridge.scene = null
    }
  }, [])

  return (
    <div className="absolute inset-0">
      <canvas ref={canvasRef} aria-label="Карта звёздной системы" role="img" />
      {!ready && !failed && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-[13px] font-semibold text-ink-2 animate-fade">
          Загружаю систему Лира…
        </div>
      )}
      {failed && (
        <div className="absolute inset-0 grid place-items-center p-6 text-center text-danger">
          Не удалось загрузить графику игры: {failed}
        </div>
      )}
    </div>
  )
}
