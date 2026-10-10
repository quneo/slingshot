import { ChevronRight, Clock, Fuel, Map as MapIcon, Pencil, RotateCcw, Trophy, Zap } from 'lucide-react'
import { CATALOG } from '../../game/levels/catalog'
import { getLevel, nextLevel } from '../../game/levels/levels'
import { buildMissionSystem } from '../../game/levels/mission'
import { gravityGain } from '../../game/rendering/scene'
import { useGame } from '../../state/gameStore'
import { flownRef } from '../../state/prediction'
import type { AttemptSummary } from '../../state/persistence'
import { cn } from '@/lib/utils'
import { Button } from '../components/button'
import { describeOutcome } from '../hud/ForecastStatus'
import { Stars } from '../hud/Stars'
import { daysLabel, kms, kmsNumber } from '../format'
import { useCompact } from '../useMedia'

function AttemptRow({ label, a, highlight }: { label: string; a: AttemptSummary | null; highlight?: boolean }) {
  return (
    <div className={cn('flex items-center justify-between gap-3 rounded-xl px-3 py-2 text-[13px]', highlight && 'border border-gold/60 bg-gold/[0.06]')}>
      <span className="text-ink-2">{label}</span>
      {a ? (
        <span className="num flex items-center gap-2 font-semibold">
          {a.success ? <Stars value={a.stars} size={12} /> : <span className="text-danger">провал</span>}
          {a.success && (
            <span>
              {kmsNumber(a.spentDv, 2)} км/с, {daysLabel(a.flightTime)}
            </span>
          )}
        </span>
      ) : (
        <span className="text-ink-3">—</span>
      )}
    </div>
  )
}

export function ResultPanel() {
  const compact = useCompact()
  const report = useGame((s) => s.report)
  const replay = useGame((s) => s.replayFlight)
  const backToPlanning = useGame((s) => s.backToPlanning)
  const startLevel = useGame((s) => s.startLevel)
  const openMenu = useGame((s) => s.openMenu)
  if (!report) return null
  const level = getLevel(report.levelId)
  const { outcome } = report
  const next = nextLevel(level.id)
  const fc = flownRef.current
  const mission = buildMissionSystem(level)
  const assists = (fc?.result.flybys ?? []).filter((f) => f.complete && f.bodyIndex !== mission.indexOf(level.target.bodyId))
  const freeGain = assists.reduce((s, f) => s + Math.abs(gravityGain(f)), 0)
  const route = [
    level.start.kind === 'docked' ? CATALOG[level.start.bodyId].name : 'Зонд',
    ...assists.map((f) => CATALOG[mission.ids[f.bodyIndex]].name),
    ...(outcome.success ? [CATALOG[level.target.bodyId].name] : []),
  ].join(' → ')
  const verdict = describeOutcome(level, outcome)

  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col p-3 sm:p-5">
      <div className="mx-auto mt-1 max-w-[640px] text-center animate-rise sm:mt-3" data-inset="top">
        <h1
          className={cn(
            'text-[30px] font-extrabold leading-tight tracking-tight sm:text-[46px]',
            outcome.success ? 'text-transparent' : 'text-danger',
          )}
          style={
            outcome.success
              ? { backgroundImage: 'linear-gradient(180deg, #fff3cf, #ffc24d)', backgroundClip: 'text', WebkitBackgroundClip: 'text' }
              : undefined
          }
        >
          {outcome.success ? 'Миссия выполнена!' : 'Миссия не выполнена'}
        </h1>
        <div className="mt-1 text-[15px] font-semibold text-ink sm:text-[18px]">{route}</div>
        <p className="mt-1 text-[13.5px] text-ink-2">
          {outcome.success
            ? assists.length > 0
              ? `Гравитация ${assists.length > 1 ? 'планет' : 'планеты'} изменила скорость на ${freeGain.toLocaleString('ru-RU', { maximumFractionDigits: 1 })} км/с — без топлива.`
              : 'Импульс рассчитан точно.'
            : `${verdict.title}${verdict.detail ? `: ${verdict.detail}` : ''}.`}
        </p>
      </div>

      <div className={cn('flex min-h-0 flex-1 items-center', compact ? 'justify-center' : 'justify-end')}>
        <section
          className={cn('panel pointer-events-auto w-[min(380px,100%)] p-5 animate-rise', !compact && 'mr-1')}
          data-inset={compact ? undefined : 'right'}
          aria-label="Результат"
        >
          <div className="flex items-baseline justify-between">
            <h2 className="text-[21px] font-extrabold">Результат</h2>
            <span className="text-[12.5px] text-ink-2">Миссия {level.number}</span>
          </div>
          <div className="my-4 flex justify-center">
            <Stars value={outcome.stars} size={46} animate />
          </div>
          <div className="space-y-3 text-[13.5px]">
            <Row icon={<Fuel size={18} className="text-go" />} label="Расход Δv" value={`${kmsNumber(outcome.spentDv, 2)} из ${kms(level.budget)}`}>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-line/70">
                <div className="h-full bg-trail" style={{ width: `${Math.min(100, (outcome.spentDv / level.budget) * 100)}%` }} />
              </div>
            </Row>
            <Row icon={<Clock size={18} className="text-trail" />} label="Время полёта" value={daysLabel(outcome.flightTime)} />
            {assists.length > 0 && (
              <Row icon={<Zap size={18} className="text-assist" />} label="Гравитация дала" value={`${freeGain.toLocaleString('ru-RU', { maximumFractionDigits: 1 })} км/с`} />
            )}
          </div>
          {outcome.success && (
            <div className="hairline mt-4 border-t pt-3 text-[12.5px] text-ink-2">
              {outcome.stars < 3 &&
                (outcome.stars < 2
                  ? `Вторая звезда — расход до ${kms(level.stars.dvForTwo, 2)}.`
                  : `Третья звезда — до ${kms(level.stars.dvForThree, 2)} и не дольше ${daysLabel(level.stars.timeForThree)}.`)}
              {outcome.stars === 3 && 'Лучше и не придумать: максимум звёзд.'}
            </div>
          )}
          <div className="hairline mt-3 space-y-1 border-t pt-3">
            <div className="flex items-center gap-2 pb-1 text-[12.5px] font-semibold text-ink-2">
              <Trophy size={14} aria-hidden /> Ваши попытки
            </div>
            <AttemptRow label={report.isNewBest ? 'Новый рекорд' : 'Лучшая'} a={report.isNewBest ? summaryOf(outcome) : report.bestBefore} highlight={report.isNewBest} />
            {!report.isNewBest && <AttemptRow label="Эта попытка" a={summaryOf(outcome)} />}
            <AttemptRow label="Предыдущая" a={report.previous} />
          </div>
        </section>
      </div>

      <div className="pointer-events-auto mt-3 flex flex-wrap items-center justify-between gap-2" data-inset="bottom">
        <div className="flex gap-2">
          <Button size="lg" onClick={replay}>
            <RotateCcw size={18} aria-hidden />
            Повторить полёт
          </Button>
          <Button size="lg" onClick={backToPlanning}>
            <Pencil size={17} aria-hidden />
            Изменить маршрут
          </Button>
        </div>
        {outcome.success && next ? (
          <Button variant="go" size="xl" className="min-w-[200px]" onClick={() => startLevel(next.id)}>
            Далее
            <ChevronRight size={24} aria-hidden />
          </Button>
        ) : (
          <Button variant={outcome.success ? 'go' : 'panel'} size="lg" onClick={() => openMenu()}>
            <MapIcon size={18} aria-hidden />К миссиям
          </Button>
        )}
      </div>
    </div>
  )
}

function Row({ icon, label, value, children }: { icon: React.ReactNode; label: string; value: string; children?: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="mt-0.5">{icon}</span>
      <div className="flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-semibold">{label}</span>
          <span className="num font-bold">{value}</span>
        </div>
        {children}
      </div>
    </div>
  )
}

const summaryOf = (o: { success: boolean; stars: number; spentDv: number; flightTime: number }): AttemptSummary => ({
  success: o.success,
  stars: o.stars,
  spentDv: o.spentDv,
  flightTime: o.flightTime,
  at: Date.now(),
})
