import { Crosshair, Gauge, Globe2, Pause, Pencil, Play, SkipForward } from 'lucide-react'
import { useEffect, useState } from 'react'
import { CATALOG } from '../../game/levels/catalog'
import { getLevel } from '../../game/levels/levels'
import { buildMissionSystem } from '../../game/levels/mission'
import { newSample, sampleTrajectory } from '../../game/physics/interpolate'
import { bodyState } from '../../game/physics/system'
import { fromDays, toKms } from '../../game/physics/units'
import { genitive } from '../../game/rendering/scene'
import { impulseMagnitude } from '../../game/rules/plan'
import type { PredictResponse } from '../../game/worker/protocol'
import { flightClock, type FlightSpeed } from '../../state/flightClock'
import { useGame } from '../../state/gameStore'
import { flownRef } from '../../state/prediction'
import { cn } from '@/lib/utils'
import { Button } from '../components/button'
import { days, kmsNumber, mkm } from '../format'
import { PlanetThumb } from '../hud/MissionCard'
import { Wordmark } from '../hud/Wordmark'
import { useCompact } from '../useMedia'

/** Re-renders the HUD ~12 times a second from the mutable flight clock. */
function useFlightTime(): number {
  const [t, setT] = useState(flightClock.time)
  useEffect(() => {
    const id = setInterval(() => setT(flightClock.time), 80)
    return () => clearInterval(id)
  }, [])
  return t
}

interface Stage {
  title: string
  tone: 'trail' | 'assist' | 'go' | 'danger'
}

function stageAt(fc: PredictResponse, levelId: string, t: number): Stage {
  const level = getLevel(levelId)
  const mission = buildMissionSystem(level)
  const r = fc.result
  const start = r.samples[0]
  if (t >= r.endTime - 1e-9) {
    if (r.endReason === 'arrived') return { title: `Прибытие к ${genitiveTo(level.target.bodyId)}`, tone: 'go' }
    if (r.endReason === 'collision') return { title: `Столкновение: ${CATALOG[mission.ids[r.collision!.bodyIndex]].name}`, tone: 'danger' }
    if (r.endReason === 'escaped') return { title: 'Корабль покинул систему', tone: 'danger' }
    return { title: 'Время вышло', tone: 'danger' }
  }
  for (const f of r.flybys) {
    if (t >= f.tIn && t <= f.tOut) return { title: `Гравитационный манёвр у ${genitive(CATALOG[mission.ids[f.bodyIndex]].name)}`, tone: 'assist' }
  }
  for (const b of r.burns) if (b.applied && b.magnitude > 0 && t >= b.t && t - b.t < fromDays(10)) return { title: 'Работает двигатель', tone: 'trail' }
  if (level.start.kind === 'docked' && t - start < fromDays(12)) return { title: `Старт с ${genitive(CATALOG[level.start.bodyId].name)}`, tone: 'trail' }
  const next = r.flybys.find((f) => f.tIn > t)
  const nextId = next ? mission.ids[next.bodyIndex] : level.target.bodyId
  return { title: `Перелёт к ${genitiveTo(nextId)}`, tone: next ? 'trail' : 'assist' }
}

const DATIVE: Record<string, string> = {
  aqua: 'Акве', rubra: 'Рубре', colossus: 'Колоссу', aurum: 'Ауруму', borey: 'Борею', viola: 'Виоле', cinder: 'Пеплу', lyra: 'Лире',
}
const genitiveTo = (id: string) => DATIVE[id] ?? id

function eventTimes(fc: PredictResponse): number[] {
  const r = fc.result
  const ts = [...r.burns.filter((b) => b.applied && b.magnitude > 0).map((b) => b.t), ...r.flybys.map((f) => f.tIn), r.endTime]
  return ts.sort((a, b) => a - b)
}

const SPEEDS: FlightSpeed[] = [1, 10, 100]

export function FlightHud() {
  const compact = useCompact()
  const levelId = useGame((s) => s.levelId)
  const flight = useGame((s) => s.flight)
  const setPlaying = useGame((s) => s.setFlightPlaying)
  const setSpeed = useGame((s) => s.setFlightSpeed)
  const setCamera = useGame((s) => s.setCamera)
  const backToPlanning = useGame((s) => s.backToPlanning)
  const plan = useGame((s) => s.plan)
  const t = useFlightTime()
  const fc = flownRef.current
  if (!fc) return null
  const level = getLevel(levelId)
  const mission = buildMissionSystem(level)
  const r = fc.result
  const start = r.samples[0]
  const ship = sampleTrajectory(r.samples, r.sampleCount, t, newSample())
  const ti = mission.indexOf(level.target.bodyId)
  const tp = bodyState(mission.system, ti, t)
  const dist = Math.hypot(ship.x - tp.x, ship.y - tp.y)
  const speed = Math.hypot(ship.vx, ship.vy)
  // the docked launch burn is part of the initial state, every other burn is a record on the trajectory
  const launchDv = level.start.kind === 'docked' ? impulseMagnitude(plan.launch) : 0
  const spent = r.burns.reduce((sum, b) => sum + (b.applied && b.t <= t ? b.magnitude : 0), launchDv)
  const stage = stageAt(fc, levelId, t)
  const progress = (t - start) / Math.max(1e-9, r.endTime - start)
  const next = eventTimes(fc).find((e) => e > t + fromDays(2))
  const target = CATALOG[level.target.bodyId]

  const toneCls = { trail: 'text-trail', assist: 'text-assist', go: 'text-go', danger: 'text-danger' }[stage.tone]

  const playPause = (
    <Button size="icon" onClick={() => setPlaying(!flight.playing)} aria-label={flight.playing ? 'Пауза' : 'Продолжить'}>
      {flight.playing ? <Pause size={20} className="fill-current" /> : <Play size={20} className="fill-current" />}
    </Button>
  )
  const speeds = (
    <div className="panel-quiet flex h-11 items-center p-1" role="radiogroup" aria-label="Скорость времени">
      {SPEEDS.map((sp) => (
        <button
          key={sp}
          role="radio"
          aria-checked={flight.speed === sp}
          onClick={() => setSpeed(sp)}
          className={cn(
            'num h-9 rounded-lg px-2.5 text-[13px] font-bold transition-colors duration-150',
            flight.speed === sp ? 'bg-trail text-space' : 'text-ink-2 hover:text-ink',
          )}
        >
          ×{sp}
        </button>
      ))}
    </div>
  )
  const skip = (
    <Button
      size="icon"
      onClick={() => next !== undefined && flightClock.seek(next - fromDays(3))}
      disabled={next === undefined}
      aria-label="К следующему событию"
      title="К следующему событию"
    >
      <SkipForward size={19} />
    </Button>
  )
  const camera = (
    <Button
      size={compact ? 'icon' : 'md'}
      onClick={() => setCamera(flight.camera === 'ship' ? 'system' : 'ship')}
      aria-label={flight.camera === 'ship' ? 'Показать систему' : 'Следить за кораблём'}
      className="h-11"
    >
      {flight.camera === 'ship' ? <Globe2 size={18} /> : <Crosshair size={18} />}
      {!compact && (flight.camera === 'ship' ? 'Система' : 'За кораблём')}
    </Button>
  )
  const edit = (
    <Button size={compact ? 'icon' : 'md'} onClick={backToPlanning} className="h-11" aria-label="Изменить маршрут">
      <Pencil size={17} />
      {!compact && 'Изменить маршрут'}
    </Button>
  )
  const progressBar = (
    <div className="relative h-2 rounded-full bg-line/50" role="progressbar" aria-label="Ход полёта" aria-valuenow={Math.round(progress * 100)}>
      <div className="absolute inset-y-0 left-0 rounded-full bg-trail" style={{ width: `${Math.min(100, progress * 100)}%` }} />
      {eventTimes(fc).map((e, i) => (
        <button
          key={i}
          className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-space bg-assist"
          style={{ left: `${((e - start) / Math.max(1e-9, r.endTime - start)) * 100}%` }}
          onClick={() => flightClock.seek(e - fromDays(3))}
          aria-label={`Перейти к ${days(e - start)}-му дню`}
        />
      ))}
    </div>
  )
  const speedText = toKms(speed).toLocaleString('ru-RU', { maximumFractionDigits: 1, minimumFractionDigits: 1 })

  if (compact) {
    return (
      <div className="pointer-events-none absolute inset-0 flex flex-col justify-between gap-2 p-2 pt-[max(8px,env(safe-area-inset-top))] pb-[max(8px,env(safe-area-inset-bottom))]">
        <section className="panel pointer-events-auto rounded-xl px-3.5 py-2.5" data-inset="top" aria-live="polite">
          <div className="flex items-baseline justify-between gap-2 text-[12px] text-ink-2">
            <span className="font-semibold">
              Полёт, <span className="num">{days(t - start)} / {days(r.endTime - start)} дн.</span>
            </span>
            <span className="num">
              {target.name}: {mkm(dist)}
            </span>
          </div>
          <div className={cn('mt-0.5 text-[15px] font-extrabold leading-tight', toneCls)}>{stage.title}</div>
        </section>
        <footer className="panel pointer-events-auto space-y-3 p-3" data-inset="bottom">
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">{progressBar}</div>
            <div className="num shrink-0 text-[13px] font-bold">
              {speedText} <span className="font-semibold text-ink-2">км/с</span>
            </div>
          </div>
          <div className="flex items-center justify-between gap-1.5">
            {playPause}
            {speeds}
            {skip}
            {camera}
            {edit}
          </div>
        </footer>
      </div>
    )
  }

  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col justify-between gap-3 p-4">
      <header className="flex items-start justify-between gap-2" data-inset="top">
        <div className="flex flex-col gap-3">
          <Wordmark compact />
          <section className="panel pointer-events-auto w-[300px] p-4" aria-live="polite">
            <div className="flex items-baseline justify-between text-[12px] text-ink-2">
              <span className="font-semibold">Полёт</span>
              <span className="num">
                {days(t - start)} / {days(r.endTime - start)} дн.
              </span>
            </div>
            <div className={cn('mt-0.5 text-[17px] font-extrabold leading-tight', toneCls)}>{stage.title}</div>
            <div className="hairline mt-3 flex items-center gap-3 border-t pt-3">
              <PlanetThumb id={target.id} size={36} />
              <div className="text-[13px]">
                <div className="text-ink-2">Цель</div>
                <div className="font-bold">
                  {target.name}, <span className="num">{mkm(dist)}</span>
                </div>
              </div>
            </div>
          </section>
        </div>
        <div className="pointer-events-auto flex flex-col items-end gap-2">
          <div className="flex gap-2">
            {playPause}
            {speeds}
            {skip}
          </div>
          <div className="flex gap-2">
            {camera}
            {edit}
          </div>
        </div>
      </header>

      <footer className="pointer-events-auto flex items-end gap-3" data-inset="bottom">
        <div className="panel flex items-center gap-3 px-4 py-3">
          <div>
            <div className="text-[12px] text-ink-2">Δv потрачено</div>
            <div className="num text-[19px] font-extrabold">
              {kmsNumber(Math.max(0, spent), 2)} <span className="text-[13px] font-semibold text-ink-2">/ {kmsNumber(level.budget)} км/с</span>
            </div>
          </div>
        </div>
        <div className="panel min-w-0 flex-1 px-4 py-[22px]">{progressBar}</div>
        <div className="panel flex items-center gap-3 px-4 py-3">
          <Gauge className="text-trail" size={26} aria-hidden />
          <div>
            <div className="text-[12px] text-ink-2">Скорость</div>
            <div className="num text-[19px] font-extrabold leading-tight">
              {speedText}
              <span className="text-[13px] font-semibold text-ink-2"> км/с</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}
