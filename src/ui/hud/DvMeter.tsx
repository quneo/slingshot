import { Fuel } from 'lucide-react'
import { getLevel } from '../../game/levels/levels'
import { impulseMagnitude, sortedNodes } from '../../game/rules/plan'
import { useGame } from '../../state/gameStore'
import { cn } from '@/lib/utils'
import { kmsNumber } from '../format'

const SEGMENT_COLORS = ['#4DCFF5', '#7FDDF8', '#A8E8FA']

/** Engine Δv budget as a fuel gauge, split by burn: each impulse is its own segment, green is what is left. */
export function DvMeter({ compact = false }: { compact?: boolean }) {
  const plan = useGame((s) => s.plan)
  const level = getLevel(useGame((s) => s.levelId))
  const parts = [impulseMagnitude(plan.launch), ...sortedNodes(plan).map(impulseMagnitude)]
  const used = parts.reduce((a, b) => a + b, 0)
  const left = Math.max(0, level.budget - used)
  const low = left / level.budget < 0.08

  return (
    <div className={cn('panel flex items-center', compact ? 'h-11 gap-2 rounded-xl px-2.5' : 'h-[60px] gap-3 px-4')}>
      <Fuel className={cn('shrink-0', low ? 'text-danger' : 'text-go')} size={compact ? 18 : 24} aria-hidden />
      <div className={cn('flex min-w-0 flex-col', compact ? 'flex-1' : 'w-[220px]')}>
        <div className="flex items-baseline justify-between gap-2 whitespace-nowrap">
          <span className={cn('font-bold', compact ? 'text-[12px]' : 'text-[14px]')}>{compact ? 'Δv' : 'Бюджет Δv'}</span>
          <span className={cn('num font-bold', compact ? 'text-[12px]' : 'text-[13px]')}>
            <span className={low ? 'text-danger' : 'text-ink'}>{kmsNumber(left)}</span>
            <span className="text-ink-2"> / {kmsNumber(level.budget)}{compact ? '' : ' км/с'}</span>
          </span>
        </div>
        <div
          className="mt-1.5 flex h-2 w-full overflow-hidden rounded-full bg-line/70"
          role="meter"
          aria-label="Остаток бюджета Δv"
          aria-valuemin={0}
          aria-valuemax={level.budget}
          aria-valuenow={left}
        >
          {parts.map((p, i) =>
            p > 0 ? (
              <div
                key={i}
                className="h-full border-r border-space/80 transition-[width] duration-150"
                style={{ width: `${(p / level.budget) * 100}%`, background: SEGMENT_COLORS[i % SEGMENT_COLORS.length] }}
              />
            ) : null,
          )}
          <div className="h-full bg-go transition-[width] duration-150" style={{ width: `${(left / level.budget) * 100}%` }} />
        </div>
      </div>
    </div>
  )
}
