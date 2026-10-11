import { ArrowRight, RotateCcw, Star } from 'lucide-react'
import { useEffect, useState } from 'react'
import { sfx } from '../../game/casual/audio'
import { getMission, MISSIONS } from '../../game/casual/levels'
import { missionOpen } from '../../game/casual/progress'
import { CATALOG } from '../../game/levels/catalog'
import { toKms } from '../../game/physics/units'
import { cn } from '../../lib/utils'
import { useCasual } from '../../state/casualStore'
import { Button } from '../components/button'

const STAR_STEP = 380
const TITLES = ['', 'Долетел!', 'Хороший пилот!', 'Идеальные окна!']
const num = (v: number) => toKms(v).toFixed(1).replace('.', ',')

export function ResultCard() {
  const result = useCasual((s) => s.result)
  const save = useCasual((s) => s.save)
  const unlockAll = useCasual((s) => s.unlockAll)
  const { restartMission, next } = useCasual.getState()
  const [shownStars, setShownStars] = useState(0)

  useEffect(() => {
    if (!result) return
    setShownStars(0)
    const timers: number[] = []
    for (let i = 0; i < result.stars; i++) {
      timers.push(
        window.setTimeout(() => {
          setShownStars(i + 1)
          sfx.star(i)
        }, 350 + i * STAR_STEP),
      )
    }
    return () => timers.forEach((t) => window.clearTimeout(t))
  }, [result])

  useEffect(() => {
    if (!result) return
    const onKey = (e: KeyboardEvent) => {
      // a focused button handles Enter itself ("Ещё раз" must not mean "Дальше")
      if (e.key === 'Enter' && !(e.target as HTMLElement | null)?.closest?.('button')) next()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [result, next])

  if (!result) return null
  const mission = getMission(result.missionId)
  const i = MISSIONS.findIndex((m) => m.id === mission.id)
  const nextMission = MISSIONS[i + 1]
  const canNext = !!nextMission && missionOpen(save, nextMission.id, unlockAll)
  const ids = [mission.start, ...mission.hops.map((h) => h.to)]
  // how full the tank stayed, against the thresholds for the stars
  const tank = mission.fuel
  const pct = (v: number) => `${Math.min(100, (v / tank) * 100)}%`

  return (
    <div className="absolute inset-0 z-30 grid place-items-center bg-space/45 p-4 animate-fade" role="dialog" aria-label="Миссия выполнена">
      <div className="panel w-full max-w-[420px] animate-rise p-5 text-center sm:p-6">
        <div className="text-[12px] font-bold uppercase tracking-[0.14em] text-ink-3">
          Миссия {mission.number} · {mission.title}
        </div>
        <h2 className="mt-1.5 font-display text-[26px] font-bold leading-tight text-ink">{TITLES[result.stars]}</h2>
        <div className="my-4 flex items-end justify-center gap-3" role="img" aria-label={`Звёзд: ${result.stars} из 3`} data-testid="result-stars">
          {[0, 1, 2].map((k) => (
            <Star
              key={`${k}-${k < shownStars}`}
              size={k === 1 ? 58 : 46}
              strokeWidth={1.4}
              className={cn(k < shownStars ? 'animate-pop fill-gold text-gold drop-shadow-[0_0_14px_rgba(255,210,122,0.75)]' : 'text-ink-3/60', k !== 1 && 'mb-1')}
              aria-hidden
            />
          ))}
        </div>
        <div className="num font-display text-[30px] font-bold leading-none text-gold" data-testid="result-spent">
          {num(result.spent)} <span className="text-[16px] text-ink-2">км/с</span>
        </div>
        <div className="mt-1 text-[12.5px] font-semibold text-ink-2">
          потрачено из {num(tank)} · за {result.days} дн.
        </div>
        {result.newBest && <div className="mt-1.5 text-[12px] font-extrabold uppercase tracking-[0.12em] text-go">Новый рекорд экономии!</div>}

        {/* where the stars are: spent less than the gold mark → 3, less than the silver → 2 */}
        <div className="relative mx-auto mt-4 h-2.5 max-w-[320px] rounded-full bg-line/60" aria-hidden>
          <div className="absolute inset-y-0 left-0 rounded-full bg-gold/80" style={{ width: pct(result.spent) }} />
          <div className="absolute -top-1 h-4.5 w-0.5 bg-go" style={{ left: pct(mission.stars[0]) }} />
          <div className="absolute -top-1 h-4.5 w-0.5 bg-assist" style={{ left: pct(mission.stars[1]) }} />
        </div>
        <div className="mx-auto mt-1 flex max-w-[320px] justify-between text-[11px] font-semibold text-ink-3">
          <span>★★★ до {num(mission.stars[0])}</span>
          <span>★★ до {num(mission.stars[1])}</span>
        </div>

        <ul className="mx-auto mt-4 max-w-[320px] space-y-1 text-left text-[13px]">
          {result.hops.map((cost, k) => (
            <li key={k} className="flex justify-between gap-3 animate-rise" style={{ animationDelay: `${300 + k * 70}ms` }}>
              <span className="text-ink-2">
                {CATALOG[ids[k]].name} → {CATALOG[ids[k + 1]].name}
              </span>
              <span className="num font-bold text-ink">{num(cost)} км/с</span>
            </li>
          ))}
          {result.spending.boost > 1e-6 && (
            <li className="flex justify-between gap-3 text-ink-3">
              <span>в том числе ускорители</span>
              <span className="num">{num(result.spending.boost)} км/с</span>
            </li>
          )}
        </ul>
        {result.stars < 3 && (
          <p className="mt-3 text-[12.5px] leading-snug text-ink-3">
            Три звезды — за экономию. Лови окна точнее: копия цели должна гореть зелёным.
          </p>
        )}
        <div className="mt-5 flex gap-2">
          <Button variant="outline" size="lg" className="flex-1" onClick={() => { sfx.click(); restartMission() }}>
            <RotateCcw size={18} /> Ещё раз
          </Button>
          <Button variant="go" size="lg" className="flex-1" onClick={() => { sfx.click(); next() }} autoFocus>
            {canNext ? 'Дальше' : 'К миссиям'} <ArrowRight size={18} />
          </Button>
        </div>
      </div>
    </div>
  )
}
