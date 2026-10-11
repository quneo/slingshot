import { ChevronLeft, Lightbulb, RotateCcw, Sparkle, Volume2, VolumeX } from 'lucide-react'
import { useEffect, useState } from 'react'
import { sfx } from '../../game/casual/audio'
import { getCasualLevel } from '../../game/casual/levels'
import { cn } from '../../lib/utils'
import { useCasual } from '../../state/casualStore'
import { Button } from '../components/button'

/** failures before the hint button appears */
const HINT_AFTER = 3

function DustSlots({ count }: { count: number }) {
  return (
    <div className="flex items-center gap-1.5" role="img" aria-label={`Звёздная пыль: ${count} из 3`} data-testid="dust">
      {[0, 1, 2].map((i) => (
        <span
          key={`${i}-${i < count}`}
          className={cn(
            'grid h-8 w-8 place-items-center rounded-full border transition-colors',
            i < count ? 'animate-pop border-gold/60 bg-gold/20 text-gold shadow-[0_0_18px_-2px_rgba(255,210,122,0.7)]' : 'border-line/70 bg-panel/60 text-ink-3',
          )}
        >
          <Sparkle size={16} className={i < count ? 'fill-gold' : undefined} aria-hidden />
        </span>
      ))}
    </div>
  )
}

function Speedometer() {
  const speed = useCasual((s) => s.hud.speed)
  const gain = useCasual((s) => s.gain)
  return (
    <div className="panel flex items-baseline gap-2 px-4 py-2" data-testid="speed">
      <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-ink-3">Скорость</span>
      <span className="num font-display text-[22px] font-bold leading-none text-ink">{speed.toFixed(1)}</span>
      <span className="text-[12px] font-semibold text-ink-2">км/с</span>
      {gain && (
        <span
          key={gain.id}
          className={cn('num animate-pop font-display text-[15px] font-bold', gain.kms >= 0 ? 'text-assist' : 'text-trail')}
        >
          {gain.kms >= 0 ? '+' : '−'}
          {Math.abs(gain.kms).toFixed(1)}
        </span>
      )}
    </div>
  )
}

function FuelBar({ fuel, charging, teach }: { fuel: number; charging: boolean; teach: boolean }) {
  return (
    <div className={cn('panel flex min-w-0 items-center gap-3 px-4 py-2.5 transition-colors', charging && 'border-assist/70')} data-testid="fuel">
      <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-ink-3">Ускоритель</span>
      <div className="h-2.5 w-24 overflow-hidden rounded-full bg-line/60 sm:w-32">
        <div
          className={cn('h-full rounded-full transition-[width] duration-200', fuel > 0.01 ? 'bg-assist' : 'bg-ink-3')}
          style={{ width: `${Math.max(0, Math.min(1, fuel)) * 100}%` }}
        />
      </div>
      {teach && fuel > 0.01 && (
        <span className="text-[12px] font-semibold text-assist">
          <span className="max-sm:hidden">зажми и отпусти — толчок к пальцу</span>
          <span className="sm:hidden">зажми экран</span>
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
    const h = window.setTimeout(() => setShown(null), 2600)
    return () => window.clearTimeout(h)
  }, [toast])
  if (!toast || shown !== toast.id) return null
  return (
    <div className="pointer-events-none absolute inset-x-0 top-[22%] z-20 flex justify-center px-4" role="status">
      <div key={toast.id} className="panel animate-pop max-w-[420px] px-5 py-3.5 text-center">
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
  const launchedBefore = useCasual((s) => s.save.launched.includes(levelId))
  const hint = useCasual((s) => s.hint)
  const { toMenu, restart, toggleMute, toggleHint } = useCasual.getState()
  const level = getCasualLevel(levelId)
  const flying = hud.phase !== 'aim'

  return (
    <>
      <header data-inset="top" className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-between gap-2 p-3">
        <div className="pointer-events-auto flex min-w-0 items-center gap-2">
          <Button variant="panel" size="icon" onClick={() => { sfx.click(); toMenu() }} aria-label="К миссиям">
            <ChevronLeft size={20} />
          </Button>
          <div className="panel min-w-0 px-3.5 py-1.5">
            <div className="truncate text-[14px] font-extrabold leading-tight">
              <span className="text-ink-3">{level.number}.</span> {level.title}
            </div>
            <div className="truncate text-[12px] font-semibold leading-tight text-ink-2" data-testid="goal">{level.goal}</div>
          </div>
        </div>
        <div className="pointer-events-auto max-sm:hidden">
          <DustSlots count={hud.dust} />
        </div>
        <div className="pointer-events-auto flex shrink-0 items-center gap-2">
          {hud.failures >= HINT_AFTER && (
            <Button
              variant="panel"
              size="icon"
              onClick={() => { sfx.click(); toggleHint() }}
              aria-label="Подсказка"
              aria-pressed={hint}
              className={cn(hint && 'border-gold/70 text-gold')}
            >
              <Lightbulb size={19} />
            </Button>
          )}
          <Button variant="panel" size="icon" onClick={() => { sfx.click(); restart() }} aria-label="Заново (R)">
            <RotateCcw size={19} />
          </Button>
          <Button variant="panel" size="icon" onClick={() => { sfx.unlock(); toggleMute() }} aria-label={muted ? 'Включить звук' : 'Выключить звук'}>
            {muted ? <VolumeX size={19} /> : <Volume2 size={19} />}
          </Button>
        </div>
      </header>
      <div className="pointer-events-none absolute inset-x-0 top-[68px] z-10 flex justify-center sm:hidden">
        <DustSlots count={hud.dust} />
      </div>

      <footer data-inset="bottom" className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex flex-wrap items-end justify-center gap-2 p-3 pb-[max(12px,env(safe-area-inset-bottom))]">
        {!flying ? (
          <div className="panel max-w-[460px] px-4 py-2.5 text-center text-[13.5px] font-semibold text-ink-2" data-testid="aim-hint">
            {hint ? 'Золотая метка — подсказка: оттяни палец туда' : level.hint}
          </div>
        ) : (
          <>
            <Speedometer />
            {level.fuel > 0 && <FuelBar fuel={hud.fuel} charging={hud.charging} teach={!launchedBefore || hud.attempts <= 1} />}
          </>
        )}
      </footer>
      <FailToast />
    </>
  )
}
