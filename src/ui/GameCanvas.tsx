import { useEffect, useRef, useState } from 'react'
import { Interaction } from '../game/controls/interaction'
import { LEVELS, getLevel } from '../game/levels/levels'
import { buildMissionSystem, type MissionSystem } from '../game/levels/mission'
import type { LevelDef } from '../game/levels/types'
import { newSample, sampleTrajectory, SAMPLE_STRIDE } from '../game/physics/interpolate'
import { fromDays, toKms } from '../game/physics/units'
import { loadAssets } from '../game/rendering/assets'
import type { Insets } from '../game/rendering/camera'
import { Scene, type MenuMarker, type SceneFrame } from '../game/rendering/scene'
import { flightClock } from '../state/flightClock'
import { availableFor, isUnlocked, levelProgress, useGame } from '../state/gameStore'
import { flownRef, forecastRef, ghostRef } from '../state/prediction'
import type { PredictResponse } from '../game/worker/protocol'
import { sceneBridge } from './sceneBridge'

/** Menu backdrop: the full system, every planet. */
const SHOWCASE = LEVELS[LEVELS.length - 1]
const MENU_TARGETS: Record<string, MenuMarker['bodyId']> = { L1: 'rubra', L2: 'colossus', L3: 'aurum', L4: 'aqua', L5: 'viola' }

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
          onTapPlanet: (id) => {
            const entry = Object.entries(MENU_TARGETS).find(([, body]) => body === id)
            if (entry) useGame.getState().selectMenuLevel(entry[0])
          },
        })

        // camera framing state
        let fitKey = ''
        let pendingFit = 0
        let menuTime = 0
        let insetsAt = 0
        let finishTimer: ReturnType<typeof setTimeout> | null = null
        let cameraMode = ''

        const fitCurrent = (animate = true) => {
          const s = useGame.getState()
          if (s.screen === 'menu') {
            scene.camera.fit(0, 0, 8.1, animate)
            return
          }
          const level = getLevel(s.levelId)
          const fc = s.phase === 'plan' ? null : flownRef.current
          if (fc && (s.flight.camera === 'system' || s.phase === 'result')) {
            const b = trajectoryBounds(fc)
            scene.camera.fit(b.x, b.y, Math.max(b.r, level.camera.radius * 0.6), animate)
          } else {
            scene.camera.fit(level.camera.x, level.camera.y, level.camera.radius, animate)
          }
        }
        sceneBridge.refit = () => fitCurrent(true)
        sceneBridge.focusShip = () => {
          const s = useGame.getState()
          const fc = s.phase === 'plan' ? forecastRef.current : flownRef.current
          if (!fc) return
          const t = s.phase === 'plan' ? s.viewTime : flightClock.time
          const p = sampleTrajectory(fc.result.samples, fc.result.sampleCount, t, tmp)
          scene.camera.animateTo(scene.camera.fitView(p.x, p.y, 0.8))
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
            if (s.phase !== 'plan') {
              if (s.phase === 'flight' && flightClock.advance(dt) && !finishTimer) {
                finishTimer = setTimeout(() => {
                  finishTimer = null
                  useGame.getState().finishFlight()
                }, 1100)
              }
              time = flightClock.time
              const fc = flownRef.current
              if (fc) {
                thrust = thrustAt(fc, level, time)
                if (s.phase === 'flight' && s.flight.camera === 'ship') {
                  const p = sampleTrajectory(fc.result.samples, fc.result.sampleCount, time, tmp)
                  if (cameraMode !== 'ship') scene.camera.animateTo(scene.camera.fitView(p.x, p.y, 1.1))
                  else if (!scene.camera.animating) scene.camera.set({ ...scene.camera.fitView(p.x, p.y, 1), zoom: scene.camera.zoom })
                } else if (cameraMode === 'ship') {
                  fitCurrent(true)
                }
              }
              cameraMode = s.phase === 'flight' ? s.flight.camera : ''
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
      {failed && (
        <div className="absolute inset-0 grid place-items-center p-6 text-center text-danger">
          Не удалось загрузить графику игры: {failed}
        </div>
      )}
    </div>
  )
}
