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
    case 'collision': {
      const hm = o.miss?.assist?.miss
      const advice =
        hm?.kind === 'timing' && hm.launchShift !== null && Math.abs(days(hm.launchShift)) >= 1
          ? ` Праща — это пролёт мимо планеты: попробуйте старт на ${Math.abs(days(hm.launchShift))} дн. ${hm.launchShift > 0 ? 'позже' : 'раньше'}.`
          : ''
      return {
        tone: 'bad',
        title: `Столкновение: ${CATALOG[o.collisionBody ?? 'lyra'].name}`,
        detail: `На ${days(o.flightTime)}-й день полёта.${advice}`,
      }
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
      if (m?.assist) {
        const helper = CATALOG[m.assist.bodyId].name
        const hm = m.assist.miss
        const why = `Без пращи до ${gen} не хватит топлива.`
        if (hm.kind === 'timing') {
          const d = Math.max(1, days(Math.abs(hm.lag)))
          const advice =
            hm.launchShift !== null && Math.abs(days(hm.launchShift)) >= 1
              ? ` Попробуйте старт на ${Math.abs(days(hm.launchShift))} дн. ${hm.launchShift > 0 ? 'позже' : 'раньше'}.`
              : ''
          return { tone: 'warn', title: `${helper}: разминулись на ${d} дн.`, detail: why + advice }
        }
        if (hm.kind === 'short' || hm.kind === 'long')
          return { tone: 'warn', title: `Не долетаете до ${genitive(helper)}`, detail: `${why} Нужно добраться до орбиты ${genitive(helper)}: не хватает ${mkm(hm.gap)}.` }
        return { tone: 'warn', title: `${helper} рядом, но праща не вышла`, detail: `${why} Пройдите ближе к ${dativeOf(helper)}.` }
      }
      if (m?.kind === 'short')
        return { tone: 'warn', title: `Не долетаете до орбиты ${gen}`, detail: `Не хватает ${mkm(m.gap)}. Больше импульса вперёд поднимет орбиту.` }
      if (m?.kind === 'long')
        return { tone: 'warn', title: `Не опускаетесь до орбиты ${gen}`, detail: `Не хватает ${mkm(m.gap)}. Нужно сильнее затормозить.` }
      if (m?.kind === 'timing') {
        const d = Math.max(1, days(Math.abs(m.lag)))
        const fact = m.lag > 0 ? 'Планета придёт в точку встречи позже вас.' : 'Планета уже прошла точку встречи.'
        const advice =
          m.launchShift !== null && Math.abs(days(m.launchShift)) >= 1
            ? ` Попробуйте старт на ${Math.abs(days(m.launchShift))} дн. ${m.launchShift > 0 ? 'позже' : 'раньше'}.`
            : ''
        return { tone: 'warn', title: `${target}: разминулись на ${d} дн.`, detail: fact + advice }
      }
      const c = m?.kind === 'near' ? m.distance : o.closestToTarget?.distance
      const miss = c !== undefined ? Math.max(0, c - level.target.zoneRadius) : null
      return {
        tone: 'warn',
        title: miss !== null ? `Промах: ${mkm(miss)}` : 'Цель не достигнута',
        detail: miss !== null ? `До кольца цели вокруг ${gen} не хватает совсем немного.` : undefined,
      }
    }
    case 'too-fast': {
      const rel = o.fastPass ? toKms(o.fastPass.relSpeed) : null
      const max = toKms(level.target.maxRelSpeed ?? 0)
      return {
        tone: 'warn',
        title: 'Скорости не совпали',
        detail:
          rel !== null
            ? `В кольце цели разница скоростей ${fmtKms(rel)} км/с, а нужно не больше ${fmtKms(max)}. Добавьте импульс, чтобы уравнять скорость с ${dativeInstr(target)}.`
            : 'Корабль проходит кольцо цели слишком быстро.',
      }
    }
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

const INSTRUMENTAL: Record<string, string> = { Рубра: 'Руброй', Аква: 'Аквой', Колосс: 'Колоссом', Аурум: 'Аурумом', Виола: 'Виолой', Борей: 'Бореем', Пепел: 'Пеплом' }
const dativeInstr = (name: string) => INSTRUMENTAL[name] ?? name
const fmtKms = (v: number) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1, minimumFractionDigits: 1 }).format(v)

const DATIVE: Record<string, string> = { Колосс: 'Колоссу', Аурум: 'Ауруму', Борей: 'Борею', Рубра: 'Рубре', Аква: 'Акве', Виола: 'Виоле', Пепел: 'Пеплу' }
const dativeOf = (name: string) => DATIVE[name] ?? name

const fmt = (v: number) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2, minimumFractionDigits: 1 }).format(toKms(v))
