import { Check, ChevronLeft, FastForward, Lightbulb, ListRestart, RotateCcw, Volume2, VolumeX } from 'lucide-react'
import { Fragment, useEffect, useState, type MouseEvent } from 'react'
import { sfx } from '../../game/casual/audio'
import { getMission } from '../../game/casual/levels'
import { CATALOG } from '../../game/levels/catalog'
import { toDays, toKms } from '../../game/physics/units'
import { cn } from '../../lib/utils'
import { useCasual, type ForecastHud } from '../../state/casualStore'
import { Button } from '../components/button'

/** failures at one hop before the hint button appears */
const HINT_AFTER = 3
const WINDOW_RATIO = 1.1
const DECENT_RATIO = 1.35

/**
 * After a mouse click the button gives focus back to the page: Space and Enter belong to the game (throw, boost),
 * not to the last button clicked. Keyboard users (detail 0) keep their focus.
 */
const release = (e: MouseEvent<HTMLButtonElement>) => {
  if (e.detail > 0) e.currentTarget.blur()
}

const num = (v: number) => v.toFixed(1).replace('.', ',')

/** Planets of the mission in order: done ones ticked, the current one gold. */
function Route({ ids, current, done }: { ids: string[]; current: number; done: number }) {
  return (
    <ol className="flex flex-wrap items-center justify-center gap-1 text-[12px] font-bold" aria-label="Маршрут" data-testid="route">
      {ids.map((id, i) => {
        const name = CATALOG[id as keyof typeof CATALOG].name
        const state = i <= done ? 'done' : i === current ? 'now' : 'later'
        return (
          <Fragment key={`${id}-${i}`}>
            {i > 0 && <span className="text-ink-3" aria-hidden>→</span>}
            <li
              className={cn(
                'flex items-center gap-1 rounded-full border px-2 py-0.5',
                state === 'done' && 'border-go/50 bg-go/15 text-go',
                state === 'now' && 'border-gold/70 bg-gold/15 text-gold',
                state === 'later' && 'border-line/70 bg-panel/70 text-ink-2',
              )}
              aria-current={state === 'now' ? 'step' : undefined}
            >
              {state === 'done' && <Check size={12} aria-hidden />}
              {name}
            </li>
          </Fragment>
        )
      })}
    </ol>
  )
}

/** The tank, and what the current throw would take out of it. */
function Tank({ fuel, tank, forecast, parked }: { fuel: number; tank: number; forecast: ForecastHud | null; parked: boolean }) {
  const left = toKms(fuel)
  const full = toKms(tank)
  const share = (v: number) => `${Math.max(0, Math.min(1, v / full)) * 100}%`
  const hop = forecast ? (forecast.total ?? forecast.launch) : 0
  const color =
    !forecast || forecast.ratio === null
      ? 'text-ink-2'
      : !forecast.affordable
        ? 'text-danger'
        : forecast.ratio <= WINDOW_RATIO
          ? 'text-go'
          : forecast.ratio <= DECENT_RATIO
            ? 'text-assist'
            : 'text-danger'
  return (
    <div className="panel min-w-0 flex-1 px-4 py-2.5 sm:max-w-[460px]" data-testid="tank">
      <div className="flex items-baseline justify-between gap-3 text-[11px] font-bold uppercase tracking-[0.12em] text-ink-3">
        <span>Бак</span>
        <span className="num normal-case tracking-normal text-ink-2">
          <span className="font-display text-[15px] text-ink">{num(left)}</span> / {num(full)} км/с
        </span>
      </div>
      <div className="relative mt-1.5 h-3 overflow-hidden rounded-full bg-line/60">
        <div className="absolute inset-y-0 left-0 rounded-full bg-trail/80 transition-[width] duration-200" style={{ width: share(left) }} />
        {forecast && (
          // the part of the tank this throw would burn, cut from the end of what is left
          <div
            className={cn('absolute inset-y-0 rounded-full', forecast.affordable ? 'bg-white/45' : 'bg-danger/70')}
            style={{ left: share(Math.max(0, left - hop)), width: share(Math.min(left, hop)) }}
          />
        )}
      </div>
      <div className={cn('mt-1.5 truncate text-[12.5px] font-bold', color)} data-testid="forecast">
        {!parked ? (
          <span className="text-go">Захват! Корабль на орбите</span>
        ) : !forecast ? (
          <span className="font-semibold text-ink-3">Потяни, чтобы прицелиться</span>
        ) : forecast.capture === null ? (
          <>Мимо цели · старт {num(forecast.launch)} км/с</>
        ) : (
          <>
            {forecast.ratio !== null && forecast.ratio <= WINDOW_RATIO && forecast.affordable && 'ОКНО! · '}
            прыжок {num(forecast.total ?? forecast.launch)} км/с
            <span className="font-semibold text-ink-3">
              {' '}
              · старт {num(forecast.launch)}
              {forecast.capture > 0.05 ? ` + торможение ${num(forecast.capture)}` : ', захват бесплатный'}
            </span>
          </>
        )}
      </div>
    </div>
  )
}

/**
 * Launch windows ahead: the cheapest hop for a launch on each day (lower is cheaper), green where it is within 10 %
 * of the best, and where "now" is. The dips are the windows; hold ⏩ to get to one faster.
 */
function WindowChart({ day }: { day: number }) {
  const chart = useCasual((s) => s.chart)
  if (!chart) return null
  const W = 300
  const H = 40
  const min = Math.min(...chart.costs)
  const top = Math.min(Math.max(...chart.costs), min * 3)
  const y = (c: number) => 3 + ((Math.min(c, top) - min) / Math.max(1e-6, top - min)) * (H - 8)
  const x = (i: number) => (i / (chart.costs.length - 1)) * W
  const line = chart.costs.map((c, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(c).toFixed(1)}`).join(' ')
  const good = chart.costs.map((c) => c <= min * 1.1)
  const now = Math.max(0, Math.min(1, (day - chart.startDay) / chart.spanDays))
  const nextGood = good.findIndex((g, i) => g && i / (chart.costs.length - 1) >= now - 0.01)
  const daysTo = nextGood < 0 ? null : Math.max(0, Math.round((nextGood / (chart.costs.length - 1) - now) * chart.spanDays))
  return (
    <div className="panel w-full max-w-[460px] px-3.5 pb-1.5 pt-2" data-testid="windows">
      <div className="flex items-baseline justify-between text-[10.5px] font-bold uppercase tracking-[0.12em] text-ink-3">
        <span>Окна старта</span>
        <span className="normal-case tracking-normal text-[12px]">
          {daysTo === null ? 'окно позади — жди следующего' : daysTo === 0 ? <span className="text-go">окно открыто!</span> : `ближайшее через ~${daysTo} дн.`}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-1 h-10 w-full" preserveAspectRatio="none" aria-hidden>
        {good.map((g, i) => (g ? <rect key={i} x={x(i) - W / chart.costs.length / 2} y={0} width={W / chart.costs.length + 0.5} height={H} fill="rgba(55,220,160,0.18)" /> : null))}
        <path d={line} fill="none" stroke="rgba(169,188,213,0.9)" strokeWidth={1.6} vectorEffect="non-scaling-stroke" />
        <line x1={now * W} x2={now * W} y1={0} y2={H} stroke="#FFD27A" strokeWidth={2} vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  )
}

function Clock({ day, deadline }: { day: number; deadline: number | null }) {
  const close = deadline !== null && deadline - day < 120
  return (
    <div className={cn('panel px-3.5 py-2 text-center', close && 'border-danger/60')} data-testid="clock">
      <div className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-ink-3">День</div>
      <div className="num font-display text-[18px] font-bold leading-tight text-ink">{day}</div>
      {deadline !== null && <div className={cn('num text-[11px] font-bold', close ? 'text-danger' : 'text-ink-3')}>срок {deadline}</div>}
    </div>
  )
}

function WaitButton() {
  const on = useCasual((s) => s.fastForward)
  const set = useCasual.getState().setFastForward
  return (
    <button
      type="button"
      className={cn(
        'panel flex select-none flex-col items-center justify-center gap-0.5 px-3.5 py-2 text-[11px] font-bold uppercase tracking-[0.1em] transition-colors',
        on ? 'border-trail/80 bg-trail/20 text-trail' : 'text-ink-2 hover:text-ink',
      )}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture?.(e.pointerId)
        set(true)
      }}
      onPointerUp={() => set(false)}
      onPointerCancel={() => set(false)}
      onLostPointerCapture={() => set(false)}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => (e.key === ' ' || e.key === 'Enter') && set(true)}
      onKeyUp={() => set(false)}
      aria-label="Ждать: держи, чтобы время бежало быстрее (F)"
      aria-pressed={on}
      data-testid="wait"
    >
      <FastForward size={20} className={on ? 'fill-trail' : undefined} aria-hidden />
      Ждать
    </button>
  )
}

function Speedometer() {
  const speed = useCasual((s) => s.hud.speed)
  const gain = useCasual((s) => s.gain)
  return (
    <div className="panel flex items-baseline gap-2 px-4 py-2" data-testid="speed">
      <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-ink-3">Скорость</span>
      <span className="num font-display text-[22px] font-bold leading-none text-ink">{num(speed)}</span>
      <span className="text-[12px] font-semibold text-ink-2">км/с</span>
      {gain && (
        <span key={gain.id} className={cn('num animate-pop font-display text-[15px] font-bold', gain.kms >= 0 ? 'text-assist' : 'text-trail')}>
          {gain.kms >= 0 ? '+' : '−'}
          {num(Math.abs(gain.kms))}
        </span>
      )}
    </div>
  )
}

function FailToast() {
  const toast = useCasual((s) => s.toast)
  const [shown, setShown] = useState<number | null>(null)
  useEffect(() => {
    if (!toast) return
    setShown(toast.id)
    const h = window.setTimeout(() => setShown(null), 2800)
    return () => window.clearTimeout(h)
  }, [toast])
  if (!toast || shown !== toast.id) return null
  return (
    <div className="pointer-events-none absolute inset-x-0 top-[24%] z-20 flex justify-center px-4" role="status">
      <div key={toast.id} className="panel animate-pop max-w-[440px] px-5 py-3.5 text-center">
        <div className="font-display text-[17px] font-bold text-danger">{toast.title}</div>
        <div className="mt-1 text-[13px] text-ink-2">{toast.text}</div>
      </div>
    </div>
  )
}

export function Hud() {
  const levelId = useCasual((s) => s.levelId)
  const hud = useCasual((s) => s.hud)
  const muted = useCasual((s) => s.save.muted)
  const hint = useCasual((s) => s.hint)
  const launchedBefore = useCasual((s) => s.save.launched.includes(levelId))
  const { toMenu, restart, restartMission, toggleMute, toggleHint } = useCasual.getState()
  const mission = getMission(levelId)
  const hop = mission.hops[Math.min(hud.hopIndex, mission.hops.length - 1)]
  const parked = hud.phase === 'parked'
  const flying = hud.phase === 'flight' || hud.phase === 'failed'
  const ids = [mission.start, ...mission.hops.map((h) => h.to)]
  const done = hud.phase === 'capture' || hud.phase === 'complete' ? hud.hopIndex + 1 : hud.hopIndex
  const deadline = mission.deadline === null ? null : Math.floor(toDays(mission.deadline))
  const windowDay = Math.round(toDays(hop.reference.wait))
  const lowFuel = parked && hud.fuel < hop.refCost * 0.75

  let tip: string
  if (hint) tip = `Подсказка: золотая метка — куда тянуть; окно примерно через ${windowDay} дн. после прилёта`
  else if (hud.hopIndex === 0 && !launchedBefore) tip = mission.hint
  else if (lowFuel) tip = 'Топлива в обрез. Если не хватит — начни миссию заново и экономь в начале'
  else tip = 'Дождись провала на графике окон, потяни резинку — и отпускай, когда копия цели станет зелёной'

  return (
    <>
      <header data-inset="top" className="pointer-events-none absolute inset-x-0 top-0 z-10 flex flex-col gap-2 p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="pointer-events-auto flex min-w-0 items-center gap-2">
            <Button variant="panel" size="icon" onClick={() => { sfx.click(); toMenu() }} aria-label="К миссиям">
              <ChevronLeft size={20} />
            </Button>
            <div className="panel min-w-0 px-3.5 py-1.5">
              <div className="truncate text-[14px] font-extrabold leading-tight">
                <span className="text-ink-3">{mission.number}.</span> {mission.title}
              </div>
              <div className="truncate text-[12px] font-semibold leading-tight text-ink-2" data-testid="goal">
                {mission.goal}
              </div>
            </div>
          </div>
          <div className="pointer-events-auto max-lg:hidden">
            <Route ids={ids} current={hud.hopIndex + 1} done={done} />
          </div>
          <div className="pointer-events-auto flex shrink-0 items-center gap-2">
            {hud.failures >= HINT_AFTER && (
              <Button
                variant="panel"
                size="icon"
                onClick={(e) => { release(e); sfx.click(); toggleHint() }}
                aria-label="Подсказка"
                aria-pressed={hint}
                className={cn(hint && 'border-gold/70 text-gold')}
              >
                <Lightbulb size={19} />
              </Button>
            )}
            <Button variant="panel" size="icon" onClick={(e) => { release(e); sfx.click(); restart() }} aria-label="Заново этот прыжок (R)">
              <RotateCcw size={19} />
            </Button>
            <Button
              variant="panel"
              size="icon"
              onClick={(e) => { release(e); sfx.click(); restartMission() }}
              aria-label="Миссию с начала"
              className={cn(lowFuel && 'border-assist/70 text-assist')}
            >
              <ListRestart size={19} />
            </Button>
            <Button variant="panel" size="icon" onClick={(e) => { release(e); sfx.unlock(); toggleMute() }} aria-label={muted ? 'Включить звук' : 'Выключить звук'}>
              {muted ? <VolumeX size={19} /> : <Volume2 size={19} />}
            </Button>
          </div>
        </div>
        <div className="pointer-events-auto flex justify-center lg:hidden">
          <Route ids={ids} current={hud.hopIndex + 1} done={done} />
        </div>
      </header>

      <footer data-inset="bottom" className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex flex-col items-center gap-2 p-3 pb-[max(12px,env(safe-area-inset-bottom))]">
        {parked && !hud.forecast && (
          <div className="panel-quiet max-w-[520px] px-3.5 py-1.5 text-center text-[12.5px] font-semibold text-ink-2" data-testid="tip">
            {tip}
          </div>
        )}
        {parked && (
          <div className="pointer-events-auto flex w-full justify-center">
            <WindowChart day={hud.day} />
          </div>
        )}
        <div className="pointer-events-auto flex w-full max-w-[760px] items-stretch justify-center gap-2">
          {flying ? (
            <>
              <Speedometer />
              <div className="panel flex min-w-0 items-center px-4 text-[12px] font-semibold text-assist" data-testid="fuel">
                <span className="truncate">
                  Бак {num(toKms(hud.fuel))} км/с
                  <span className="max-sm:hidden"> · зажми — толчок к пальцу</span>
                </span>
              </div>
            </>
          ) : (
            <Tank fuel={hud.fuel} tank={mission.fuel} forecast={hud.forecast} parked={parked} />
          )}
          <Clock day={hud.day} deadline={deadline} />
          {parked && <WaitButton />}
        </div>
      </footer>
      <FailToast />
    </>
  )
}
