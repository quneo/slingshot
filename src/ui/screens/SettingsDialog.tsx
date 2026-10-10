import { useState } from 'react'
import { useGame } from '../../state/gameStore'
import type { Settings } from '../../state/persistence'
import { cn } from '@/lib/utils'
import { Button } from '../components/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../components/dialog'

function Toggle({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 py-3">
      <span>
        <span className="block font-bold">{label}</span>
        <span className="block text-[12.5px] leading-snug text-ink-2">{hint}</span>
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn('relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors duration-150', checked ? 'bg-go' : 'bg-line')}
      >
        <span className={cn('absolute left-0 top-0.5 h-5 w-5 rounded-full bg-ink transition-transform duration-150', checked ? 'translate-x-[22px]' : 'translate-x-0.5')} />
      </button>
    </label>
  )
}

export function SettingsDialog() {
  const open = useGame((s) => s.settingsOpen)
  const setOpen = useGame((s) => s.setSettingsOpen)
  const settings = useGame((s) => s.save.settings)
  const update = useGame((s) => s.updateSettings)
  const resetProgress = useGame((s) => s.resetProgress)
  const [confirmReset, setConfirmReset] = useState(false)
  const set = (patch: Partial<Settings>) => update(patch)

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) setConfirmReset(false)
      }}
    >
      <DialogContent>
        <DialogTitle>Настройки</DialogTitle>
        <DialogDescription>Сохраняются в этом браузере.</DialogDescription>
        <div className="hairline mt-3 divide-y divide-line/60 border-y">
          <Toggle
            label="Крупные планеты"
            hint="Рисовать планеты больше их размера. Столкновения всё равно считаются по настоящему радиусу."
            checked={settings.enlargePlanets}
            onChange={(v) => set({ enlargePlanets: v })}
          />
          <Toggle
            label="Прошлая попытка"
            hint="Показывать серым пунктиром маршрут последнего запуска."
            checked={settings.showGhost}
            onChange={(v) => set({ showGhost: v })}
          />
          <Toggle
            label="Меньше анимации"
            hint="Без бегущего пунктира, мерцания звёзд и вращения планет в меню."
            checked={settings.reducedMotion}
            onChange={(v) => set({ reducedMotion: v })}
          />
          <Toggle
            label="Открыть все миссии"
            hint="Можно играть в любом порядке."
            checked={settings.unlockAll}
            onChange={(v) => set({ unlockAll: v })}
          />
        </div>
        <div className="mt-4 flex items-center justify-between gap-3">
          <span className="text-[12.5px] text-ink-2">{confirmReset ? 'Звёзды и рекорды пропадут.' : 'Прогресс кампании'}</span>
          {confirmReset ? (
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => setConfirmReset(false)}>
                Оставить
              </Button>
              <Button
                size="sm"
                variant="danger"
                onClick={() => {
                  resetProgress()
                  setConfirmReset(false)
                }}
              >
                Сбросить прогресс
              </Button>
            </div>
          ) : (
            <Button size="sm" variant="outline" onClick={() => setConfirmReset(true)}>
              Сбросить прогресс
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
