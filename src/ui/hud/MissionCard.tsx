import { ChevronDown, Lightbulb } from 'lucide-react'
import { useState } from 'react'
import { CATALOG } from '../../game/levels/catalog'
import { LEVELS, getLevel } from '../../game/levels/levels'
import type { LevelDef } from '../../game/levels/types'
import { planetSpriteUrl } from '../../game/rendering/assets'
import { useGame } from '../../state/gameStore'
import { cn } from '@/lib/utils'
import { Button } from '../components/button'
import { toKms } from '../../game/physics/units'
import { days, kms, mkm, plural } from '../format'
import { ForecastStatus } from './ForecastStatus'

export function goalText(level: LevelDef): string {
  const zone = mkm(level.target.zoneRadius)
  if (level.target.kind === 'flyby') return `Пройти ближе ${zone} от центра планеты`
  const rel = toKms(level.target.maxRelSpeed ?? 0).toLocaleString('ru-RU', { maximumFractionDigits: 1 })
  return `Подойти ближе ${zone} и уравнять скорость: разница не больше ${rel} км/с`
}

export function burnsText(level: LevelDef): string {
  if (level.maxBurns === 1) return level.start.kind === 'docked' ? 'Один импульс — только старт' : 'Один импульс'
  const extra = level.maxBurns - 1
  return `Старт и ещё ${extra} ${plural(extra, 'коррекция', 'коррекции', 'коррекций')}`
}

export function PlanetThumb({ id, size = 40 }: { id: keyof typeof CATALOG; size?: number }) {
  return (
    <img
      src={planetSpriteUrl(id)}
      alt=""
      width={size}
      height={size}
      className="shrink-0 rounded-full"
      style={{ boxShadow: `0 0 18px -4px ${CATALOG[id].visual.color}` }}
      draggable={false}
    />
  )
}

export function Constraints({ level }: { level: LevelDef }) {
  const [w0, w1] = level.start.launchWindow
  const rows: [string, string][] = [
    ['Бюджет Δv', kms(level.budget)],
    ['Импульсы', burnsText(level)],
  ]
  if (level.maxFlightTime !== null) rows.push(['Лимит полёта', `${days(level.maxFlightTime)} дн.`])
  if (w1 > w0) rows.push(['Окно старта', `${days(w0)}–${days(w1)}-й день`])
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[13px]">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-ink-2">{k}</dt>
          <dd className="num text-right font-semibold">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

export function Hints({ level }: { level: LevelDef }) {
  const hintStep = useGame((s) => s.hintStep)
  const showNextHint = useGame((s) => s.showNextHint)
  return (
    <div>
      {hintStep > 0 && (
        <ol className="mb-2 space-y-1.5">
          {level.hints.slice(0, hintStep).map((h, i) => (
            <li key={i} className="flex gap-2 rounded-lg bg-gold/[0.07] px-2.5 py-2 text-[12.5px] leading-snug text-ink animate-rise">
              <span className="num font-bold text-gold">{i + 1}</span>
              <span>{h}</span>
            </li>
          ))}
        </ol>
      )}
      {hintStep < 3 && (
        <Button variant="ghost" size="sm" className="-ml-2 text-gold hover:text-gold" onClick={showNextHint}>
          <Lightbulb size={15} aria-hidden />
          {hintStep === 0 ? 'Подсказка' : 'Ещё подсказка'}
        </Button>
      )}
    </div>
  )
}

/** Left mission card on the planning screen. */
export function MissionCard({ className }: { className?: string }) {
  const level = getLevel(useGame((s) => s.levelId))
  const [open, setOpen] = useState(true)
  const target = CATALOG[level.target.bodyId]
  return (
    <section className={cn('panel w-[320px] overflow-hidden', className)} data-inset="left" aria-label="Миссия">
      <button
        className="flex w-full items-center gap-3 px-5 pb-3 pt-4 text-left"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <div className="min-w-0 flex-1">
          <div className="text-[12.5px] font-semibold text-ink-2">
            Миссия {level.number} из {LEVELS.length}
          </div>
          <h2 className="text-[21px] font-extrabold leading-tight tracking-tight">{level.title}</h2>
        </div>
        <ChevronDown size={18} className={cn('shrink-0 text-ink-2 transition-transform duration-200', !open && '-rotate-90')} aria-hidden />
      </button>
      {open && (
        <div className="space-y-3 px-5 pb-4">
          <p className="text-[13.5px] leading-snug text-ink-2">{level.briefing}</p>
          <div className="hairline flex items-center gap-3 border-t pt-3">
            <PlanetThumb id={target.id} size={44} />
            <div>
              <div className="text-[12.5px] text-ink-2">Цель</div>
              <div className="font-bold">{target.name}</div>
              <div className="text-[12.5px] leading-snug text-ink-2">{goalText(level)}</div>
            </div>
          </div>
          <div className="hairline border-t pt-3">
            <Constraints level={level} />
          </div>
          <ForecastStatus />
          <Hints level={level} />
        </div>
      )}
    </section>
  )
}
