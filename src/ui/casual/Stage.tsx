import { useEffect, useRef, useState } from 'react'
import { sfx } from '../../game/casual/audio'
import { CASUAL_LEVELS, getCasualLevel } from '../../game/casual/levels'
import { CasualRenderer, type InputView } from '../../game/casual/render/renderer'
import { POINTS } from '../../game/casual/scoring'
import { Session, type GameEvent } from '../../game/casual/session'
import { accusativeOf, genitiveOf } from '../../game/levels/names'
import { bodyState } from '../../game/physics/system'
import { loadAssets } from '../../game/rendering/assets'
import type { Insets } from '../../game/rendering/camera'
import { COLORS } from '../../game/rendering/palette'
import { useCasual } from '../../state/casualStore'

/** The menu backdrop replays the grand tour. */
const DEMO = CASUAL_LEVELS[CASUAL_LEVELS.length - 1]
/** pulls shorter than this (px) are taps, not launches */
const MIN_PULL = 14
/** a result card waits for the victory lap */
const RESULT_DELAY = 1.4

function measureInsets(): Insets {
  const w = window.innerWidth
  const h = window.innerHeight
  const ins: Insets = { top: 0, right: 0, bottom: 0, left: 0 }
  document.querySelectorAll<HTMLElement>('[data-inset]').forEach((el) => {
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) return
    if (el.dataset.inset === 'top') ins.top = Math.max(ins.top, r.bottom)
    if (el.dataset.inset === 'bottom') ins.bottom = Math.max(ins.bottom, h - r.top)
    // the menu column: on wide screens the backdrop flight plays beside it, on phones above it
    if (el.dataset.inset === 'left' && r.right < w * 0.6) ins.left = Math.max(ins.left, r.right - 40)
    if (el.dataset.inset === 'below' && w < 768) ins.bottom = Math.max(ins.bottom, h - r.top)
  })
  ins.top = Math.min(ins.top + 6, h * 0.3)
  ins.bottom = Math.min(ins.bottom + 6, h * 0.75)
  ins.left = Math.max(ins.left, Math.min(12, w * 0.03))
  ins.right = Math.min(12, w * 0.03)
  return ins
}

function failureText(s: Session, e: Extract<GameEvent, { kind: 'failed' }>): { title: string; text: string } {
  if (e.reason === 'crashed') {
    const id = e.bodyIndex !== null ? s.world.planetOf[e.bodyIndex] : null
    if (id === 'lyra') return { title: 'Сгорел в короне Лиры', text: 'Звезда тянет сильнее всех — держись от неё подальше' }
    if (!id) return { title: 'Врезался в астероид', text: 'Проскочи между камнями — или подожди, пока они пролетят' }
    if (e.bodyIndex === s.world.targetIndex) return { title: `Врезался в ${accusativeOf(id)}`, text: 'Почти! Целься в кольцо, а не в саму планету' }
    return { title: `Врезался в ${accusativeOf(id)}`, text: `Пролетай мимо ${genitiveOf(id)}, а не в него — праща работает на краю` }
  }
  if (e.reason === 'lost') return { title: 'Улетел в пустоту', text: 'Слишком сильно. Призрак покажет, где ты пролетел' }
  return { title: 'Не долетел', text: 'Попробуй сильнее или по-другому — тут нужна праща' }
}

export function Stage() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [failed, setFailed] = useState<string | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current!
    let disposed = false
    let raf = 0
    let resizeObs: ResizeObserver | null = null
    const cleanups: (() => void)[] = []

    loadAssets()
      .then(async (assets) => {
        await document.fonts?.ready
        if (disposed) return
        const renderer = new CasualRenderer(canvas, assets)
        const fx = renderer.fx
        const input: InputView = { pull: null, hover: null, maxPull: 150, showHint: false, teach: false }

        let session = new Session(DEMO)
        let menu = true
        let resultAt = -1
        let lastHud = 0
        let lastStretch = 0
        let drag: { id: number; x0: number; y0: number; history: { t: number; x: number; y: number }[] } | null = null
        let chargeId: number | null = null
        /** keyboard boost being held (Space), turned from the ship's heading by ←/→ */
        let keyCharge = false
        let keyTurn = 0
        let lastPhase = session.phase
        let insetsAt = -Infinity

        const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
        const syncMotion = () => {
          fx.calm = motion.matches
        }
        syncMotion()
        motion.addEventListener('change', syncMotion)
        cleanups.push(() => motion.removeEventListener('change', syncMotion))

        const resize = () => {
          const parent = canvas.parentElement!
          renderer.resize(parent.clientWidth, parent.clientHeight, window.devicePixelRatio || 1)
          input.maxPull = Math.min(210, Math.max(110, Math.min(parent.clientWidth, parent.clientHeight) * 0.3))
        }
        resize()
        resizeObs = new ResizeObserver(resize)
        resizeObs.observe(canvas.parentElement!)

        const syncLevel = () => {
          const st = useCasual.getState()
          const wantMenu = st.screen === 'menu'
          const want = wantMenu ? DEMO : getCasualLevel(st.levelId)
          if (wantMenu === menu && session.level === want) return
          menu = wantMenu
          session = new Session(want)
          // start close to the new view, then settle in: quick, but still a "fly-in"
          renderer.camera.insets = measureInsets()
          const v = renderer.camera.fitView(want.view.x, want.view.y, want.view.radius)
          renderer.camera.set({ ...v, zoom: v.zoom * 0.7 })
          fx.clear()
          resultAt = -1
          drag = null
          chargeId = null
          keyCharge = false
          input.pull = null
          sfx.chargeStop()
        }
        cleanups.push(useCasual.subscribe((st, prev) => {
          if (st.screen !== prev.screen || st.levelId !== prev.levelId) syncLevel()
          if (st.restartTick !== prev.restartTick && !menu) {
            session.reset()
            resultAt = -1
            sfx.chargeStop()
          }
        }))
        syncLevel()

        // ── input
        const local = (e: PointerEvent) => {
          const r = canvas.getBoundingClientRect()
          return { x: e.clientX - r.left, y: e.clientY - r.top }
        }
        const aimFromPull = (px: number, py: number) => {
          const len = Math.hypot(px, py)
          const k = len > input.maxPull ? input.maxPull / len : 1
          input.pull = { x: px * k, y: py * k }
          const p = session.level.power
          session.setAim((-input.pull.x / input.maxPull) * p, (input.pull.y / input.maxPull) * p)
        }
        const worldDir = (x: number, y: number) => ({ x: x - renderer.shipX, y: -(y - renderer.shipY) })
        const capture = (id: number) => {
          try {
            canvas.setPointerCapture(id)
          } catch {
            // synthetic or already released pointer: dragging still works while it stays over the canvas
          }
        }

        const onDown = (e: PointerEvent) => {
          sfx.unlock()
          // the main button only: right-click is not a throw, and on some systems its release never arrives
          if (e.pointerType === 'mouse' && e.button !== 0) return
          if (menu || useCasual.getState().result) return
          const p = local(e)
          if (session.phase === 'failed') session.reset()
          if (session.phase === 'aim' && !drag) {
            capture(e.pointerId)
            drag = { id: e.pointerId, x0: p.x, y0: p.y, history: [{ t: performance.now(), x: p.x, y: p.y }] }
            aimFromPull(0, 0)
          } else if (session.phase === 'flight' && chargeId === null && !keyCharge) {
            const d = worldDir(p.x, p.y)
            if (session.startCharge(d.x, d.y)) {
              capture(e.pointerId)
              chargeId = e.pointerId
              sfx.chargeStart()
            }
          }
        }
        const onMove = (e: PointerEvent) => {
          const p = local(e)
          input.hover = e.pointerType === 'mouse' ? p : null
          if (drag && e.pointerId === drag.id) {
            const now = performance.now()
            drag.history.push({ t: now, x: p.x, y: p.y })
            if (drag.history.length > 24) drag.history.shift()
            aimFromPull(p.x - drag.x0, p.y - drag.y0)
            if (now - lastStretch > 70 && input.pull) {
              lastStretch = now
              sfx.stretch(Math.hypot(input.pull.x, input.pull.y) / input.maxPull)
            }
          } else if (chargeId === e.pointerId) {
            const d = worldDir(p.x, p.y)
            session.aimCharge(d.x, d.y)
          }
        }
        const onUp = (e: PointerEvent) => {
          if (drag && e.pointerId === drag.id) {
            // a finger wobbles as it lifts: if the last moment moved only a little, launch the aim from just before it
            const now = performance.now()
            const p = local(e)
            const before = drag.history.find((h) => now - h.t <= 70) ?? drag.history[drag.history.length - 1]
            if (Math.hypot(p.x - before.x, p.y - before.y) < 10) aimFromPull(before.x - drag.x0, before.y - drag.y0)
            const pulled = input.pull ? Math.hypot(input.pull.x, input.pull.y) : 0
            if (pulled >= MIN_PULL && session.launch()) useCasual.getState().markLaunched(session.level.id)
            else session.clearAim()
            drag = null
            input.pull = null
          } else if (chargeId === e.pointerId) {
            chargeId = null
            if (!session.releaseCharge()) sfx.chargeStop()
          }
        }
        const onCancel = (e: PointerEvent) => {
          if (drag && e.pointerId === drag.id) {
            drag = null
            input.pull = null
            session.clearAim()
          } else if (chargeId === e.pointerId) {
            chargeId = null
            session.cancelCharge()
            sfx.chargeStop()
          }
        }
        const onLeave = () => {
          input.hover = null
        }
        const onMenu = (e: Event) => e.preventDefault()
        /** the window lost focus mid-gesture: drop it rather than throw or boost blindly */
        const onBlur = () => {
          if (drag) onCancel(new PointerEvent('pointercancel', { pointerId: drag.id }))
          if (chargeId !== null) onCancel(new PointerEvent('pointercancel', { pointerId: chargeId }))
          if (keyCharge) {
            keyCharge = false
            session.cancelCharge()
            sfx.chargeStop()
          }
        }

        // ── keyboard: ←/→ turn and ↑/↓ stretch the throw, Space throws; in flight hold Space to boost
        const DEG = Math.PI / 180
        const keyDir = () => {
          const st = session.ship()
          if (!st) return null
          const a = Math.atan2(st.vy, st.vx) + keyTurn
          return { x: Math.cos(a), y: Math.sin(a) }
        }
        const onKeyDown = (e: KeyboardEvent) => {
          if (menu || useCasual.getState().result || drag) return
          if ((e.target as HTMLElement | null)?.closest?.('button, input, textarea, a')) return
          const arrow = e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown'
          const step = e.shiftKey ? 5 : 1
          if (arrow && (session.phase === 'aim' || session.phase === 'failed')) {
            e.preventDefault()
            sfx.unlock()
            if (session.phase === 'failed') session.reset()
            const power = session.level.power
            let aim = session.aim
            if (!aim) {
              const home = bodyState(session.world.system, session.world.homeIndex, 0)
              const len = Math.hypot(home.vx, home.vy)
              aim = { dvx: (home.vx / len) * power * 0.5, dvy: (home.vy / len) * power * 0.5 }
            }
            let ang = Math.atan2(aim.dvy, aim.dvx)
            let mag = Math.hypot(aim.dvx, aim.dvy)
            if (e.key === 'ArrowLeft') ang += step * DEG
            if (e.key === 'ArrowRight') ang -= step * DEG
            if (e.key === 'ArrowUp') mag = Math.min(power, mag + power * 0.02 * step)
            if (e.key === 'ArrowDown') mag = Math.max(power * 0.1, mag - power * 0.02 * step)
            session.setAim(Math.cos(ang) * mag, Math.sin(ang) * mag)
            input.pull = { x: (-Math.cos(ang) * mag * input.maxPull) / power, y: (Math.sin(ang) * mag * input.maxPull) / power }
            sfx.stretch(mag / power)
          } else if ((e.key === ' ' || e.key === 'Enter') && session.phase === 'aim' && session.aim && !e.repeat) {
            e.preventDefault()
            if (session.launch()) useCasual.getState().markLaunched(session.level.id)
            input.pull = null
          } else if (e.key === ' ' && session.phase === 'flight' && !e.repeat && !keyCharge && chargeId === null) {
            e.preventDefault()
            keyTurn = 0
            const d = keyDir()
            if (d && session.startCharge(d.x, d.y)) {
              keyCharge = true
              sfx.chargeStart()
            }
          } else if (keyCharge && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
            e.preventDefault()
            keyTurn += (e.key === 'ArrowLeft' ? 1 : -1) * 15 * DEG
          } else if (e.key === ' ') e.preventDefault()
        }
        const onKeyUp = (e: KeyboardEvent) => {
          if (e.key !== ' ' || !keyCharge) return
          keyCharge = false
          if (!session.releaseCharge()) sfx.chargeStop()
        }

        canvas.addEventListener('pointerdown', onDown)
        canvas.addEventListener('pointermove', onMove)
        canvas.addEventListener('pointerup', onUp)
        canvas.addEventListener('pointercancel', onCancel)
        canvas.addEventListener('lostpointercapture', onCancel)
        canvas.addEventListener('pointerleave', onLeave)
        canvas.addEventListener('contextmenu', onMenu)
        window.addEventListener('blur', onBlur)
        window.addEventListener('keydown', onKeyDown)
        window.addEventListener('keyup', onKeyUp)
        cleanups.push(() => {
          canvas.removeEventListener('pointerdown', onDown)
          canvas.removeEventListener('pointermove', onMove)
          canvas.removeEventListener('pointerup', onUp)
          canvas.removeEventListener('pointercancel', onCancel)
          canvas.removeEventListener('lostpointercapture', onCancel)
          canvas.removeEventListener('pointerleave', onLeave)
          canvas.removeEventListener('contextmenu', onMenu)
          window.removeEventListener('blur', onBlur)
          window.removeEventListener('keydown', onKeyDown)
          window.removeEventListener('keyup', onKeyUp)
        })

        // ── what happened → particles, captions, sounds
        /** the flight ended under a held finger or key: silence the charge, forget the gesture */
        const stopCharging = () => {
          chargeId = null
          keyCharge = false
          sfx.chargeStop()
        }
        const handle = (e: GameEvent, now: number) => {
          const zoom = renderer.camera.zoom
          const store = useCasual.getState()
          switch (e.kind) {
            case 'launch': {
              useCasual.setState({ gain: null })
              sfx.launch(e.power)
              sfx.buzz(15)
              fx.kick(3 + e.power * 5)
              const home = bodyState(session.world.system, session.world.homeIndex, 0)
              fx.burst(home.x, home.y, zoom, { count: 26, speed: 190, colors: ['#BDF1FF', COLORS.cyan, '#FFFFFF'], size: 2.2, life: 0.6, drag: 0.08 })
              break
            }
            case 'boost':
              sfx.boost(e.size)
              renderer.noteBoost(now)
              fx.kick(2 + e.size * 3)
              fx.burst(e.x, e.y, zoom, {
                count: 10 + Math.round(e.size * 16), speed: 150 + e.size * 120, dir: Math.atan2(-e.dirY, -e.dirX), spread: 0.9,
                colors: [COLORS.amber, '#FFE2A8', '#FFFFFF'], size: 2.2, life: 0.55, drag: 0.1,
              })
              break
            case 'dust':
              sfx.dust(e.count)
              sfx.buzz(10)
              fx.burst(e.x, e.y, zoom, { count: 30, speed: 170, colors: [COLORS.gold, '#FFF4D6', COLORS.amber], size: 2.4, life: 0.8, drag: 0.06 })
              fx.popup(e.x, e.y, `+${POINTS.stardust}`, COLORS.gold, e.count === 3 ? 'ВСЯ ПЫЛЬ!' : `пыль ${e.count}/3`, 20, 1.3)
              break
            case 'flybyIn':
              sfx.flyby()
              break
            case 'slingshot': {
              sfx.slingshot(e.combo)
              sfx.buzz([25, 40, 25])
              fx.kick(5 + Math.min(6, Math.abs(e.gainKms) * 0.4))
              fx.flashOnce(0.35)
              const ship = session.ship()
              if (ship) {
                fx.burst(ship.x, ship.y, zoom, { count: 34, speed: 230, colors: [COLORS.amber, COLORS.gold, '#FFFFFF'], size: 2.6, life: 0.9, drag: 0.08 })
                const sign = e.gainKms >= 0 ? '+' : '−'
                const title = e.combo > 1 ? `ПРАЩА ×${e.combo}!` : 'ПРАЩА!'
                fx.popup(ship.x, ship.y, title, COLORS.amber, `${sign}${Math.abs(e.gainKms).toFixed(1)} км/с${e.gainKms < 0 ? ' · тормоз' : ''}`, 30, 1.9)
                if (e.close) {
                  sfx.closePass()
                  fx.popup(ship.x, ship.y, 'ВПРИТИРКУ!', COLORS.cyan, `+${POINTS.closePass}`, 20, 1.6, 0.35)
                }
              }
              store.showGain(e.gainKms)
              break
            }
            case 'arrived':
              stopCharging()
              sfx.arrive()
              sfx.buzz([30, 60, 30, 60, 60])
              fx.flashOnce(0.9)
              fx.kick(4)
              for (let k = 0; k < 3; k++) {
                fx.burst(e.x, e.y, zoom, {
                  count: 40, speed: 160 + k * 90, colors: [COLORS.gold, COLORS.cyan, '#FFFFFF', COLORS.green], size: 2.6, life: 1.4, drag: 0.12,
                })
              }
              fx.popup(e.x, e.y, 'ДОЛЕТЕЛ!', COLORS.gold, null, 34, 2.2)
              resultAt = now + RESULT_DELAY
              break
            case 'failed': {
              stopCharging()
              const t = failureText(session, e)
              if (e.reason === 'crashed') {
                sfx.crash()
                sfx.buzz(90)
                fx.kick(16)
                fx.flashOnce(0.6, '244, 119, 119')
                fx.burst(e.x, e.y, zoom, { count: 60, speed: 260, colors: ['#FFFFFF', COLORS.amber, COLORS.red, '#FFD27A'], size: 2.8, life: 1, drag: 0.05 })
                fx.burst(e.x, e.y, zoom, { count: 20, speed: 60, colors: ['rgba(140, 150, 170, 0.6)'], size: 5, life: 1.6, drag: 0.3, glow: false })
              } else sfx.lost()
              store.showToast(t.title, t.text)
              break
            }
          }
        }

        // ── the loop
        let last = performance.now()
        const frame = (ms: number) => {
          raf = requestAnimationFrame(frame)
          const now = ms / 1000
          const dt = Math.min(0.05, Math.max(0, (ms - last) / 1000))
          last = ms
          const store = useCasual.getState()
          if (keyCharge) {
            const d = keyDir()
            if (d) session.aimCharge(d.x, d.y)
          }
          session.update(dt)
          const events = session.drain()
          // a new attempt starts clean: no speed gain left over from the last one, no keyboard band
          if (session.phase === 'aim' && lastPhase !== 'aim') {
            if (useCasual.getState().gain) useCasual.setState({ gain: null })
            if (!drag) input.pull = null
          }
          lastPhase = session.phase
          if (menu) {
            // attract mode: the reference throw, again and again
            if (session.phase === 'aim' && session.phaseClock > 0.8) {
              session.setAim(session.level.reference.dvx, session.level.reference.dvy)
              session.launch()
            } else if ((session.phase === 'arrived' || session.phase === 'failed') && session.phaseClock > 2.5) session.reset()
          } else {
            for (const e of events) handle(e, now)
            if (resultAt > 0 && now >= resultAt && session.phase === 'arrived' && session.score) {
              resultAt = -1
              store.finish(session.level.id, session.score)
            }
            if (ms - lastHud > 90) {
              lastHud = ms
              store.setHud({
                phase: session.phase,
                dust: session.flight && session.phase !== 'aim' ? session.flight.collected.filter(Boolean).length : 0,
                fuel: session.level.fuel > 0 ? (session.flight && session.phase !== 'aim' ? session.flight.fuelLeft : session.level.fuel) / session.level.fuel : 0,
                speed: Math.round(session.phase === 'aim' ? 0 : session.speedKms() * 10) / 10,
                charging: !!session.charge,
                failures: session.failures,
                attempts: session.attempts,
              })
            }
          }
          input.showHint = !menu && store.hint
          input.teach = !menu && !store.save.launched.includes(session.level.id) && session.attempts === 0
          // panels move rarely: measuring them every frame would force a layout per frame
          if (ms - insetsAt > 250) {
            insetsAt = ms
            renderer.camera.insets = measureInsets()
          }
          renderer.render(session, input, now, dt, menu)
        }
        raf = requestAnimationFrame(frame)
        if (import.meta.env.DEV) Object.assign(window, { __session: () => session, __renderer: renderer })
      })
      .catch((err: unknown) => setFailed(err instanceof Error ? err.message : String(err)))

    return () => {
      disposed = true
      cancelAnimationFrame(raf)
      resizeObs?.disconnect()
      cleanups.forEach((c) => c())
    }
  }, [])

  return (
    <div className="absolute inset-0">
      <canvas ref={canvasRef} className="block h-full w-full" aria-label="Космос: оттяни корабль и отпусти" />
      {failed && (
        <div className="absolute inset-0 grid place-items-center p-6 text-center text-ink-2">
          Не удалось загрузить игру: {failed}
        </div>
      )}
    </div>
  )
}
