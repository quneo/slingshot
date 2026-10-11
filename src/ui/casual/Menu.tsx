import { Lock, Star, Volume2, VolumeX } from 'lucide-react'
import { sfx } from '../../game/casual/audio'
import { CASUAL_LEVELS, CHAPTERS } from '../../game/casual/levels'
import { chapterOpen, levelOpen, recordOf, totalStars } from '../../game/casual/progress'
import { cn } from '../../lib/utils'
import { useCasual } from '../../state/casualStore'
import { Button } from '../components/button'
import { Wordmark } from '../hud/Wordmark'

const MAX_STARS = CASUAL_LEVELS.length * 3

export function Menu() {
  const save = useCasual((s) => s.save)
  const unlockAll = useCasual((s) => s.unlockAll)
  const openLevel = useCasual((s) => s.openLevel)
  const toggleMute = useCasual((s) => s.toggleMute)
  const stars = totalStars(save)
  // the first open level not finished yet glows: "play this"
  const nextUp = CASUAL_LEVELS.find((l) => levelOpen(save, l.id, unlockAll) && !recordOf(save, l.id).done)

  return (
    <div className="scroll-thin absolute inset-0 overflow-y-auto">
      <div className="pointer-events-none fixed inset-0 bg-[linear-gradient(90deg,rgba(8,15,32,0.92)_0%,rgba(8,15,32,0.7)_42%,rgba(8,15,32,0.05)_75%)] max-md:bg-[linear-gradient(180deg,rgba(8,15,32,0)_0%,rgba(8,15,32,0.1)_28%,rgba(8,15,32,0.9)_45%,rgba(8,15,32,0.96)_100%)]" />
      <div className="fixed right-3 top-3 z-10">
        <Button
          variant="panel"
          size="icon"
          onClick={() => {
            sfx.unlock()
            toggleMute()
          }}
          aria-label={save.muted ? 'Включить звук' : 'Выключить звук'}
        >
          {save.muted ? <VolumeX size={19} /> : <Volume2 size={19} />}
        </Button>
      </div>
      <div data-inset="left" className="relative flex min-h-full w-full max-w-[520px] flex-col gap-6 px-5 pb-8 pt-8 max-md:mx-auto max-md:pt-[34vh] md:px-10 md:pt-12">
        <div className="animate-rise" data-inset="below">
          <Wordmark />
          <p className="mt-4 max-w-[400px] text-[15px] leading-relaxed text-ink-2">
            Брось корабль, как из рогатки. Пролети мимо гиганта — и он разгонит тебя бесплатно.
          </p>
          <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-gold/30 bg-gold/10 px-3 py-1.5 text-[13px] font-bold text-gold">
            <Star size={15} className="fill-gold" aria-hidden />
            <span className="num" data-testid="total-stars">
              {stars} / {MAX_STARS}
            </span>
          </div>
        </div>

        {CHAPTERS.map((ch, ci) => {
          const open = chapterOpen(save, ch.number, unlockAll)
          const levels = CASUAL_LEVELS.filter((l) => l.chapter === ch.number)
          return (
            <section key={ch.number} className="animate-rise" style={{ animationDelay: `${80 + ci * 70}ms` }}>
              <div className="mb-2.5 flex items-baseline justify-between gap-3">
                <h2 className="font-display text-[13px] font-bold uppercase tracking-[0.14em] text-ink">
                  <span className="text-ink-3">Глава {ch.number}.</span> {ch.title}
                </h2>
                {!open && (
                  <span className="flex shrink-0 items-center gap-1 text-[12px] font-bold text-ink-3">
                    <Lock size={12} aria-hidden /> нужно <Star size={12} className="fill-ink-3" aria-hidden /> {ch.starsToOpen}
                  </span>
                )}
              </div>
              <div className="grid grid-cols-4 gap-2">
                {levels.map((l) => {
                  const rec = recordOf(save, l.id)
                  const unlocked = levelOpen(save, l.id, unlockAll)
                  const hot = l === nextUp
                  return (
                    <button
                      key={l.id}
                      type="button"
                      disabled={!unlocked}
                      onClick={() => {
                        sfx.unlock()
                        sfx.click()
                        openLevel(l.id)
                      }}
                      aria-label={`Миссия ${l.number}: ${l.title}${unlocked ? '' : ' (закрыта)'}`}
                      className={cn(
                        'group relative flex aspect-[1/1.08] flex-col items-center justify-center gap-1 rounded-2xl border p-1.5 text-center transition-[transform,border-color,background-color] duration-150',
                        unlocked
                          ? 'border-line/80 bg-panel/80 hover:-translate-y-0.5 hover:border-trail/70 active:scale-[0.97]'
                          : 'cursor-not-allowed border-line/40 bg-panel/40 opacity-55',
                        hot && 'border-go/70 shadow-[0_0_0_3px_rgba(55,220,160,0.15),0_12px_30px_-12px_rgba(55,220,160,0.6)]',
                      )}
                    >
                      <span className={cn('font-display text-[22px] font-bold leading-none', rec.done ? 'text-ink' : unlocked ? 'text-trail' : 'text-ink-3')}>
                        {unlocked ? l.number : <Lock size={18} aria-hidden />}
                      </span>
                      <span className="line-clamp-2 min-h-[2.2em] text-[10.5px] font-semibold leading-tight text-ink-2">{l.title}</span>
                      <span className="flex gap-0.5" aria-label={`Звёзд: ${rec.stars}`}>
                        {[0, 1, 2].map((i) => (
                          <Star key={i} size={11} className={i < rec.stars ? 'fill-gold text-gold' : 'text-ink-3/70'} aria-hidden />
                        ))}
                      </span>
                    </button>
                  )
                })}
              </div>
            </section>
          )
        })}
        <p className="text-[12px] leading-relaxed text-ink-3">
          Звёзды — это звёздная пыль: она лежит на самом крутом маршруте. Главы открываются звёздами.
          <span className="mt-1.5 block max-md:hidden">
            Клавиатура: ←/→ — направление, ↑/↓ — сила (с Shift — крупнее), Пробел — бросок. В полёте удерживайте Пробел
            для ускорителя, ←/→ поворачивают толчок. R — заново, Esc — к миссиям.
          </span>
        </p>
      </div>
    </div>
  )
}
