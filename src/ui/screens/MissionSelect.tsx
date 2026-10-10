import { Lock, Play, Settings } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { LEVELS, getLevel } from '../../game/levels/levels'
import type { LevelDef } from '../../game/levels/types'
import { isUnlocked, levelProgress, useGame } from '../../state/gameStore'
import { cn } from '@/lib/utils'
import { Button } from '../components/button'
import { daysLabel, kmsNumber } from '../format'
import { Constraints, PlanetThumb } from '../hud/MissionCard'
import { Stars } from '../hud/Stars'
import { Wordmark } from '../hud/Wordmark'
import { useCompact } from '../useMedia'

const START_BODY = (l: LevelDef) => (l.start.kind === 'docked' ? l.start.bodyId : null)

function RoutePreview({ level }: { level: LevelDef }) {
  const from = START_BODY(level)
  return (
    <div className="panel-quiet relative flex h-[92px] items-center justify-between overflow-hidden px-5">
      {from ? <PlanetThumb id={from} size={44} /> : <span className="grid h-11 w-11 place-items-center text-[11px] font-bold text-trail">зонд</span>}
      <svg className="absolute inset-x-16 top-1/2 h-12 -translate-y-1/2" viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden>
        <path d="M2 30 Q 50 -6 98 22" fill="none" stroke="#4DCFF5" strokeWidth="1.6" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
      </svg>
      <PlanetThumb id={level.target.bodyId} size={52} />
    </div>
  )
}

function Difficulty({ value }: { value: number }) {
  return (
    <div className="flex items-center gap-1.5" aria-label={`Сложность ${value} из 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className={cn('h-2.5 w-2.5 rounded-full', i <= value ? 'bg-go' : 'bg-line')} />
      ))}
    </div>
  )
}

function SelectedCard({ level, className }: { level: LevelDef; className?: string }) {
  const save = useGame((s) => s.save)
  const prog = levelProgress(save, level.id)
  return (
    <section className={cn('panel w-[330px] space-y-4 p-5', className)} data-inset="left" aria-label="Выбранная миссия">
      <div className="flex items-baseline justify-between text-[12.5px] text-ink-2">
        <span className="font-semibold">Кампания</span>
        <span className="num">
          {level.number}/{LEVELS.length}
        </span>
      </div>
      <div>
        <h2 className="text-[26px] font-extrabold leading-tight tracking-tight">Миссия {level.number}</h2>
        <div className="text-[17px] font-semibold">{level.title}</div>
      </div>
      <RoutePreview level={level} />
      <p className="text-[13.5px] leading-relaxed text-ink-2">{level.briefing}</p>
      <div className="flex items-center justify-between">
        <span className="text-[13px] text-ink-2">Сложность</span>
        <Difficulty value={level.difficulty} />
      </div>
      <div className="hairline border-t pt-3">
        <Constraints level={level} />
      </div>
      <div className="hairline flex items-center justify-between border-t pt-3 text-[13px]">
        <span className="text-ink-2">Лучший результат</span>
        {prog.best ? (
          <span className="num flex items-center gap-2 font-semibold">
            <Stars value={prog.stars} size={13} />
            {kmsNumber(prog.best.spentDv, 2)} км/с, {daysLabel(prog.best.flightTime)}
          </span>
        ) : (
          <span className="text-ink-3">ещё не пройдена</span>
        )}
      </div>
    </section>
  )
}

function MissionTile({ level, selected, onClick }: { level: LevelDef; selected: boolean; onClick: () => void }) {
  const save = useGame((s) => s.save)
  const ref = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' })
  }, [selected])
  const locked = !isUnlocked(save, level.id)
  const prog = levelProgress(save, level.id)
  const from = START_BODY(level)
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        'relative flex h-[104px] w-[150px] shrink-0 flex-col items-center justify-between rounded-2xl border px-2 pb-2 pt-2.5 transition-[border-color,background-color] duration-150',
        selected ? 'border-trail bg-trail/10 shadow-[0_0_0_3px_rgba(77,207,245,0.15)]' : 'border-line/80 bg-space/40 hover:border-trail/50',
        locked && 'opacity-60',
      )}
    >
      <span className={cn('num absolute left-2 top-2 grid h-6 w-6 place-items-center rounded-full border text-[12px] font-extrabold', selected ? 'border-trail text-trail' : 'border-ink-2/60 text-ink-2')}>
        {level.number}
      </span>
      {locked && <Lock size={15} className="absolute right-2.5 top-2.5 text-ink-2" aria-label="Закрыта" />}
      <span className="mt-1 flex items-center">
        {from && <PlanetThumb id={from} size={24} />}
        <span className="mx-0.5 h-px w-4 border-t border-dashed border-trail/70" />
        <PlanetThumb id={level.target.bodyId} size={36} />
      </span>
      <span className="text-[13px] font-bold leading-tight">{level.title}</span>
      <Stars value={prog.stars} size={11} />
    </button>
  )
}

export function MissionSelect() {
  const compact = useCompact()
  const menuLevelId = useGame((s) => s.menuLevelId)
  const select = useGame((s) => s.selectMenuLevel)
  const startLevel = useGame((s) => s.startLevel)
  const save = useGame((s) => s.save)
  const openSettings = useGame((s) => s.setSettingsOpen)
  const level = getLevel(menuLevelId)
  const locked = !isUnlocked(save, level.id)
  const total = LEVELS.reduce((s, l) => s + levelProgress(save, l.id).stars, 0)

  const play = (
    <Button variant="go" size="xl" className={cn(compact ? 'h-14 w-full' : 'min-w-[200px] self-stretch')} disabled={locked} onClick={() => startLevel(level.id)}>
      {locked ? <Lock size={22} aria-hidden /> : <Play size={24} className="fill-current" aria-hidden />}
      {locked ? 'Закрыта' : 'Играть'}
    </Button>
  )

  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col gap-3 p-3 sm:p-4 pt-[max(12px,env(safe-area-inset-top))] pb-[max(12px,env(safe-area-inset-bottom))]">
      <header className="flex items-start justify-between gap-3" data-inset="top">
        <Wordmark compact={compact} />
        <div className="pointer-events-auto flex items-center gap-2">
          <div className="panel-quiet flex h-11 items-center gap-2 whitespace-nowrap px-3 text-[13px] font-bold">
            <Stars value={1} size={14} />
            <span className="num">
              {total} из {LEVELS.length * 3}
            </span>
          </div>
          <Button size="icon" onClick={() => openSettings(true)} aria-label="Настройки">
            <Settings size={19} />
          </Button>
        </div>
      </header>

      {!compact && (
        <div className="flex min-h-0 flex-1 gap-6">
          <SelectedCard level={level} className="pointer-events-auto max-h-full self-start overflow-y-auto" />
        </div>
      )}
      {compact && (
        <div className="flex min-h-0 flex-1 flex-col justify-end">
          <section className="panel pointer-events-auto space-y-2 p-4" aria-label="Выбранная миссия">
            <div className="flex items-center gap-3">
              <PlanetThumb id={level.target.bodyId} size={40} />
              <div className="min-w-0 flex-1">
                <div className="text-[12px] text-ink-2">Миссия {level.number} из {LEVELS.length}</div>
                <div className="text-[17px] font-extrabold leading-tight">{level.title}</div>
              </div>
              <Difficulty value={level.difficulty} />
            </div>
            <p className="text-[13px] leading-snug text-ink-2">{level.briefing}</p>
            <div className="text-[12.5px] text-ink-2">
              Бюджет Δv: <span className="num font-semibold text-ink">{kmsNumber(level.budget)} км/с</span>
              {level.maxFlightTime !== null && (
                <>
                  , лимит: <span className="num font-semibold text-ink">{daysLabel(level.maxFlightTime)}</span>
                </>
              )}
            </div>
          </section>
        </div>
      )}

      <section className="panel pointer-events-auto flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:gap-4 sm:p-4" data-inset="bottom" aria-label="Кампания">
        {!compact && (
          <div className="w-[150px] shrink-0">
            <h1 className="text-[19px] font-extrabold">Выбор миссии</h1>
            <div className="text-[12.5px] leading-snug text-ink-2">Учебная система Лира: от первого импульса до двух пращей подряд</div>
          </div>
        )}
        <div className="scroll-x -my-1 flex min-w-0 flex-1 gap-2 py-1">
          {LEVELS.map((l) => (
            <MissionTile key={l.id} level={l} selected={l.id === menuLevelId} onClick={() => select(l.id)} />
          ))}
        </div>
        {play}
      </section>
    </div>
  )
}

