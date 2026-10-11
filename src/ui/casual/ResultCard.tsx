import { ArrowRight, RotateCcw, Star } from 'lucide-react'
import { useEffect, useState } from 'react'
import { sfx } from '../../game/casual/audio'
import { CASUAL_LEVELS, getCasualLevel } from '../../game/casual/levels'
import { levelOpen } from '../../game/casual/progress'
import { cn } from '../../lib/utils'
import { useCasual } from '../../state/casualStore'
import { Button } from '../components/button'

const STAR_STEP = 380
const COUNT_TIME = 900

const TITLES = ['Долетел!', 'Неплохо!', 'Красиво!', 'Идеально!']

export function ResultCard() {
  const result = useCasual((s) => s.result)
  const save = useCasual((s) => s.save)
  const unlockAll = useCasual((s) => s.unlockAll)
  const { restart, next } = useCasual.getState()
  const [shownStars, setShownStars] = useState(0)
  const [shownScore, setShownScore] = useState(0)

  useEffect(() => {
    if (!result) return
    setShownStars(0)
    setShownScore(0)
    const timers: number[] = []
    for (let i = 0; i < result.score.stars; i++) {
      timers.push(window.setTimeout(() => {
        setShownStars(i + 1)
        sfx.star(i)
      }, 350 + i * STAR_STEP))
    }
    const start = performance.now() + 250
    let raf = 0
    const tick = (now: number) => {
      const k = Math.min(1, Math.max(0, (now - start) / COUNT_TIME))
      setShownScore(Math.round(result.score.total * (1 - Math.pow(1 - k, 3))))
      if (k < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      timers.forEach((t) => window.clearTimeout(t))
      cancelAnimationFrame(raf)
    }
  }, [result])

  useEffect(() => {
    if (!result) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') next()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [result, next])

  if (!result) return null
  const level = getCasualLevel(result.levelId)
  const i = CASUAL_LEVELS.findIndex((l) => l.id === level.id)
  const nextLevel = CASUAL_LEVELS[i + 1]
  const canNext = !!nextLevel && levelOpen(save, nextLevel.id, unlockAll)
  const { score } = result

  return (
    <div className="absolute inset-0 z-30 grid place-items-center bg-space/45 p-4 animate-fade" role="dialog" aria-label="Миссия выполнена">
      <div className="panel w-full max-w-[400px] animate-rise p-5 text-center sm:p-6">
        <div className="text-[12px] font-bold uppercase tracking-[0.14em] text-ink-3">
          Миссия {level.number} · {level.title}
        </div>
        <h2 className="mt-1.5 font-display text-[28px] font-bold leading-tight text-ink">{TITLES[score.stars]}</h2>
        <div className="my-4 flex items-end justify-center gap-3" role="img" aria-label={`Звёзд: ${score.stars} из 3`} data-testid="result-stars">
          {[0, 1, 2].map((k) => (
            <Star
              key={`${k}-${k < shownStars}`}
              size={k === 1 ? 58 : 46}
              strokeWidth={1.4}
              className={cn(
                k < shownStars ? 'animate-pop fill-gold text-gold drop-shadow-[0_0_14px_rgba(255,210,122,0.75)]' : 'text-ink-3/60',
                k !== 1 && 'mb-1',
              )}
              aria-hidden
            />
          ))}
        </div>
        <div className="num font-display text-[34px] font-bold leading-none text-gold" data-testid="result-score">
          {shownScore.toLocaleString('ru-RU')}
        </div>
        {result.newBest && <div className="mt-1.5 text-[12px] font-extrabold uppercase tracking-[0.12em] text-go">Новый рекорд!</div>}
        <ul className="mx-auto mt-4 max-w-[320px] space-y-1 text-left text-[13px]">
          {score.lines.map((l, k) => (
            <li key={k} className="flex justify-between gap-3 animate-rise" style={{ animationDelay: `${300 + k * 70}ms` }}>
              <span className="text-ink-2">{l.label}</span>
              <span className="num font-bold text-ink">+{l.points.toLocaleString('ru-RU')}</span>
            </li>
          ))}
        </ul>
        {score.stars < 3 && (
          <p className="mt-3 text-[12.5px] leading-snug text-ink-3">Вся звёздная пыль лежит на одном маршруте. Найди его — получишь три звезды.</p>
        )}
        <div className="mt-5 flex gap-2">
          <Button variant="outline" size="lg" className="flex-1" onClick={() => { sfx.click(); restart() }}>
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
