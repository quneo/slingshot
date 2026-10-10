import { AlertTriangle, CheckCircle2, CircleDashed, Flame, Orbit, Timer } from 'lucide-react'
import { CATALOG } from '../../game/levels/catalog'
import { getLevel } from '../../game/levels/levels'
import type { LevelDef } from '../../game/levels/types'
import type { MissionOutcome } from '../../game/rules/evaluate'
import { planKey } from '../../game/rules/plan'
import { useGame } from '../../state/gameStore'
import { cn } from '@/lib/utils'
import { toKms } from '../../game/physics/units'
import { days, mkm } from '../format'
import { genitive } from '../../game/rendering/scene'
import { Stars } from './Stars'

export interface StatusView {
  tone: 'ok' | 'warn' | 'bad' | 'wait'
  title: string
  detail?: string
}

export function describeOutcome(level: LevelDef, o: MissionOutcome): StatusView {
  const target = CATALOG[level.target.bodyId].name
  if (o.success) return { tone: 'ok', title: `${target}: цель достигнута`, detail: `на ${days(o.flightTime)}-й день полёта` }
  switch (o.failure) {
    case 'collision':
      return {
        tone: 'bad',
        title: `Столкновение: ${CATALOG[o.collisionBody ?? 'lyra'].name}`,
        detail: `на ${days(o.flightTime)}-й день полёта`,
      }
    case 'escaped':
      return { tone: 'bad', title: 'Корабль улетает из системы', detail: 'Импульс слишком сильный или направлен мимо цели.' }
    case 'deadline':
      return {
        tone: 'warn',
        title: 'Не успеваем',
        detail: `прибытие на ${days(o.flightTime)}-й день, лимит ${days(level.maxFlightTime ?? 0)}`,
      }
    case 'missed': {
      const m = o.miss
      const gen = genitive(target)
      const canShiftLaunch = level.start.kind === 'docked' && level.start.launchWindow[1] > level.start.launchWindow[0]
      if (m?.kind === 'short')
        return { tone: 'warn', title: `Не долетаете до орбиты ${gen}`, detail: `Не хватает ${mkm(m.gap)}. Больше импульса вперёд поднимет орбиту.` }
      if (m?.kind === 'long')
        return { tone: 'warn', title: `Не опускаетесь до орбиты ${gen}`, detail: `Не хватает ${mkm(m.gap)}. Нужно сильнее затормозить.` }
      if (m?.kind === 'timing') {
        const d = Math.max(1, days(Math.abs(m.lag)))
        return m.lag > 0
          ? {
              tone: 'warn',
              title: `${target} опаздывает на ${d} дн.`,
              detail: canShiftLaunch ? 'Планета придёт в точку встречи позже вас. Стартуйте позже.' : 'Планета придёт в точку встречи позже вас. Прилетите туда позже.',
            }
          : {
              tone: 'warn',
              title: `${target} прошла раньше на ${d} дн.`,
              detail: canShiftLaunch ? 'Планета уже миновала точку встречи. Стартуйте раньше.' : 'Планета уже миновала точку встречи. Нужно прилететь раньше.',
            }
      }
      const c = m?.kind === 'near' ? m.distance : o.closestToTarget?.distance
      const miss = c !== undefined ? Math.max(0, c - level.target.zoneRadius) : null
      return {
        tone: 'warn',
        title: miss !== null ? `Промах: ${mkm(miss)}` : 'Цель не достигнута',
        detail: miss !== null ? `До кольца цели вокруг ${gen} не хватает совсем немного.` : undefined,
      }
    }
    case 'too-fast':
      return { tone: 'warn', title: 'Слишком быстро', detail: 'Корабль проносится мимо, не сбросив скорость.' }
    case 'over-budget':
      return { tone: 'bad', title: 'Бюджет Δv превышен' }
    case 'too-many-burns':
      return { tone: 'bad', title: 'Слишком много импульсов' }
    case 'launch-window':
      return { tone: 'bad', title: 'Старт вне окна' }
    case 'node-time':
      return { tone: 'bad', title: 'Импульс вне времени полёта' }
    default:
      return { tone: 'bad', title: 'Расчёт не сошёлся' }
  }
}

const TONE = {
  ok: { icon: CheckCircle2, cls: 'text-go', ring: 'border-go/45 bg-go/10' },
  warn: { icon: AlertTriangle, cls: 'text-assist', ring: 'border-assist/45 bg-assist/10' },
  bad: { icon: Flame, cls: 'text-danger', ring: 'border-danger/45 bg-danger/10' },
  wait: { icon: CircleDashed, cls: 'text-ink-2', ring: 'border-line bg-white/5' },
}

export function useForecastView(): { view: StatusView; outcome: MissionOutcome | null; fresh: boolean } {
  const level = getLevel(useGame((s) => s.levelId))
  const forecast = useGame((s) => s.forecast)
  const plan = useGame((s) => s.plan)
  const fresh = forecast.key === planKey(plan)
  if (!forecast.outcome) return { view: { tone: 'wait', title: 'Считаю траекторию…' }, outcome: null, fresh }
  return { view: describeOutcome(level, forecast.outcome), outcome: forecast.outcome, fresh }
}

/** Forecast verdict: the honest answer to "will this plan work?" */
export function ForecastStatus({ compact = false }: { compact?: boolean }) {
  const { view, outcome, fresh } = useForecastView()
  const level = getLevel(useGame((s) => s.levelId))
  const t = TONE[view.tone]
  const Icon = t.icon
  return (
    <div
      className={cn('rounded-xl border px-3 py-2.5 transition-colors duration-200', t.ring, !fresh && 'opacity-70')}
      aria-live="polite"
    >
      <div className="flex items-start gap-2.5">
        <Icon className={cn('mt-0.5 shrink-0', t.cls)} size={18} aria-hidden />
        <div className="min-w-0 flex-1">
          <div className={cn('font-bold leading-tight', t.cls)}>{view.title}</div>
          {view.detail && !compact && <div className="mt-0.5 text-[12.5px] leading-snug text-ink-2">{view.detail}</div>}
        </div>
        {outcome?.success && <Stars value={outcome.stars} size={compact ? 13 : 15} />}
      </div>
      {!compact && outcome?.success && outcome.stars < 3 && (
        <div className="mt-2 flex items-center gap-1.5 text-[12px] text-ink-2">
          {outcome.stars < 2 ? <Orbit size={13} aria-hidden /> : <Timer size={13} aria-hidden />}
          {outcome.stars < 2
            ? `Ещё звезда, если потратить не больше ${fmt(level.stars.dvForTwo)} км/с`
            : `Третья звезда: Δv ≤ ${fmt(level.stars.dvForThree)} км/с и полёт ≤ ${days(level.stars.timeForThree)} дн.`}
        </div>
      )}
    </div>
  )
}

const fmt = (v: number) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2, minimumFractionDigits: 1 }).format(toKms(v))
