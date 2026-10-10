import { GraduationCap, X } from 'lucide-react'
import { useEffect } from 'react'
import { getLevel } from '../../game/levels/levels'
import type { TutorialStep } from '../../game/levels/types'
import { planKey } from '../../game/rules/plan'
import { useGame } from '../../state/gameStore'
import { cn } from '@/lib/utils'
import { Button } from '../components/button'

const TEXT: Record<TutorialStep, { title: string; body: string }> = {
  'drag-impulse': {
    title: 'Задайте импульс старта',
    body: 'Потяните зелёную точку у Аквы. Длина стрелки — сила толчка, направление — куда толкаем.',
  },
  'read-forecast': {
    title: 'Пунктир — это прогноз',
    body: 'Он посчитан по законам гравитации. Доведите его до жёлтого кольца: там Рубра окажется, когда вы долетите.',
  },
  launch: { title: 'Маршрут готов', body: 'Прогноз попадает в цель. Нажмите «Пуск» и посмотрите полёт.' },
  'launch-window': {
    title: 'Выберите момент старта',
    body: 'Колосс сейчас не там, где нужно. Двигайте дату старта в редакторе и следите за точкой встречи.',
  },
  flyby: {
    title: 'Праща',
    body: 'Пролёт рядом с Колоссом меняет скорость без топлива. Пройдите позади него, по ходу его движения — и Аурум станет ближе.',
  },
  'add-node': {
    title: 'Второй импульс',
    body: 'Нажмите на пунктир, чтобы поставить ещё один импульс в этой точке пути. Его силу и направление задаёт та же зелёная стрелка.',
  },
}

/** Short contextual coaching for the first levels; each step completes by doing it. */
export function TutorialCoach({ className, compact = false }: { className?: string; compact?: boolean }) {
  const levelId = useGame((s) => s.levelId)
  const step = useGame((s) => s.tutorialStep)
  const plan = useGame((s) => s.plan)
  const forecast = useGame((s) => s.forecast)
  const advance = useGame((s) => s.advanceTutorial)
  const finish = useGame((s) => s.finishTutorial)
  const level = getLevel(levelId)
  const steps = level.tutorial ?? []
  const current = steps[step]
  const fresh = forecast.key === planKey(plan)
  const success = fresh && !!forecast.outcome?.success

  useEffect(() => {
    if (!current) return
    const initial = planKey(level.initialPlan)
    const done =
      (current === 'drag-impulse' && planKey(plan) !== initial) ||
      ((current === 'read-forecast' || current === 'launch-window' || current === 'flyby') && success) ||
      (current === 'add-node' && plan.nodes.length > 0)
    if (done) {
      if (step + 1 >= steps.length) finish()
      else advance(step + 1)
    }
  }, [current, plan, success, step, steps.length, level.initialPlan, advance, finish])

  if (!current) return null
  const text = TEXT[current]
  return (
    <div className={cn('panel pointer-events-auto flex max-w-[440px] animate-rise', compact ? 'gap-2.5 rounded-xl p-3' : 'gap-3 p-4', className)} role="status" key={current}>
      <GraduationCap className="mt-0.5 shrink-0 text-trail" size={compact ? 18 : 22} aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <div className="font-extrabold text-trail">{text.title}</div>
          <div className="num text-[12px] text-ink-2">
            {step + 1}/{steps.length}
          </div>
        </div>
        <p className={cn('mt-1 leading-snug text-ink', compact ? 'text-[12.5px]' : 'text-[13.5px]')}>{text.body}</p>
        {current !== 'launch' && !compact && (
          <div className="mt-2 flex gap-2">
            <Button size="sm" variant="ghost" className="-ml-2" onClick={() => (step + 1 >= steps.length ? finish() : advance(step + 1))}>
              Понятно
            </Button>
          </div>
        )}
      </div>
      <button className="-mr-1 -mt-1 self-start rounded-md p-1 text-ink-2 hover:text-ink" onClick={finish} aria-label="Скрыть обучение">
        <X size={16} />
      </button>
    </div>
  )
}
