import { ChevronDown, ChevronLeft, Crosshair, Eraser, Maximize2, Settings, Undo2 } from 'lucide-react'
import { useState } from 'react'
import { CATALOG } from '../../game/levels/catalog'
import { getLevel } from '../../game/levels/levels'
import { useGame } from '../../state/gameStore'
import { cn } from '@/lib/utils'
import { Button } from '../components/button'
import { DvMeter } from '../hud/DvMeter'
import { ForecastStatus, useForecastView } from '../hud/ForecastStatus'
import { Constraints, goalText, Hints, MissionCard, PlanetThumb } from '../hud/MissionCard'
import { RouteDock } from '../hud/RouteDock'
import { Timeline } from '../hud/Timeline'
import { TutorialCoach } from '../hud/TutorialCoach'
import { Wordmark } from '../hud/Wordmark'
import { sceneBridge } from '../sceneBridge'
import { useCompact } from '../useMedia'

function MapTools({ vertical = false }: { vertical?: boolean }) {
  const undo = useGame((s) => s.undo)
  const canUndo = useGame((s) => s.undoStack.length > 0)
  const resetPlan = useGame((s) => s.resetPlan)
  const openSettings = useGame((s) => s.setSettingsOpen)
  return (
    <div className={cn('flex gap-2', vertical && 'flex-col')}>
      <Button size="icon" onClick={undo} disabled={!canUndo} aria-label="Отменить" title="Отменить (Ctrl+Z)">
        <Undo2 size={19} />
      </Button>
      <Button size="icon" onClick={resetPlan} aria-label="Начать маршрут заново" title="Начать маршрут заново">
        <Eraser size={18} />
      </Button>
      <Button size="icon" onClick={() => sceneBridge.refit()} aria-label="Показать всю миссию" title="Показать всю миссию">
        <Maximize2 size={18} />
      </Button>
      <Button size="icon" onClick={() => sceneBridge.focusShip()} aria-label="К кораблю" title="К кораблю">
        <Crosshair size={19} />
      </Button>
      <Button size="icon" onClick={() => openSettings(true)} aria-label="Настройки" title="Настройки">
        <Settings size={19} />
      </Button>
    </div>
  )
}

function ScaleNote({ className }: { className?: string }) {
  const enlarged = useGame((s) => s.save.settings.enlargePlanets)
  if (!enlarged) return null
  return (
    <div className={cn('panel-quiet pointer-events-none px-2.5 py-1 text-[11.5px] font-semibold text-ink-2', className)}>
      Размеры планет не в масштабе
    </div>
  )
}

export function PlanningScreen() {
  const compact = useCompact()
  const openMenu = useGame((s) => s.openMenu)
  return compact ? <CompactPlanning onBack={() => openMenu()} /> : <WidePlanning onBack={() => openMenu()} />
}

function WidePlanning({ onBack }: { onBack: () => void }) {
  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col gap-3 p-4">
      <header className="flex items-start justify-between gap-4">
        <div className="pointer-events-auto flex items-center gap-3">
          <Button size="icon" onClick={onBack} aria-label="К выбору миссий" title="К выбору миссий">
            <ChevronLeft size={22} />
          </Button>
          <Wordmark compact />
        </div>
        <div className="pointer-events-auto flex items-start gap-2" data-inset="top">
          <DvMeter />
          <MapTools />
        </div>
      </header>
      <div className="relative flex min-h-0 flex-1 items-start justify-between">
        <MissionCard className="pointer-events-auto max-h-full overflow-y-auto" />
        <TutorialCoach className="absolute right-0 top-0 w-[380px]" />
        <ScaleNote className="absolute bottom-0 right-0" />
      </div>
      <div className="pointer-events-auto">
        <Timeline className="mb-2" />
        <RouteDock />
      </div>
    </div>
  )
}

function CompactPlanning({ onBack }: { onBack: () => void }) {
  const level = getLevel(useGame((s) => s.levelId))
  const [missionOpen, setMissionOpen] = useState(false)
  const target = CATALOG[level.target.bodyId]
  const { view } = useForecastView()
  const tone = { ok: 'text-go', warn: 'text-assist', bad: 'text-danger', wait: 'text-ink-2' }[view.tone]
  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col gap-2 p-2 pt-[max(8px,env(safe-area-inset-top))] pb-[max(8px,env(safe-area-inset-bottom))]">
      <div className="space-y-2" data-inset="top">
        <header className="pointer-events-auto flex items-center gap-1.5">
          <Button size="icon" onClick={onBack} aria-label="К выбору миссий">
            <ChevronLeft size={22} />
          </Button>
          <div className="min-w-0 flex-1">
            <DvMeter compact />
          </div>
          <MapToolsCompact />
        </header>
        <button
          className="panel pointer-events-auto flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left"
          onClick={() => setMissionOpen((o) => !o)}
          aria-expanded={missionOpen}
        >
          <PlanetThumb id={target.id} size={30} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-extrabold">
              {level.number}. {level.title}
            </div>
            <div className={cn('truncate text-[12.5px] font-semibold', tone)} aria-live="polite">
              {view.title}
            </div>
          </div>
          <ChevronDown size={18} className={cn('shrink-0 text-ink-2 transition-transform duration-200', missionOpen && 'rotate-180')} aria-hidden />
        </button>
      </div>
      {missionOpen && (
        <div className="panel pointer-events-auto max-h-[50vh] space-y-3 overflow-y-auto p-4 animate-rise">
          <p className="text-[13.5px] leading-snug text-ink-2">{level.briefing}</p>
          <div className="text-[13px]">
            <span className="text-ink-2">Цель — {target.name}: </span>
            <span className="font-semibold">{goalText(level)}</span>
          </div>
          <Constraints level={level} />
          <ForecastStatus />
          <Hints level={level} />
        </div>
      )}
      <div className="relative min-h-0 flex-1">
        {!missionOpen && <TutorialCoach compact className="absolute inset-x-0 top-0" />}
        <ScaleNote className="absolute bottom-0 right-0 text-[11px]" />
      </div>
      <div className="pointer-events-auto space-y-2">
        <Timeline compact />
        <RouteDock compact />
      </div>
    </div>
  )
}

function MapToolsCompact() {
  const undo = useGame((s) => s.undo)
  const canUndo = useGame((s) => s.undoStack.length > 0)
  const openSettings = useGame((s) => s.setSettingsOpen)
  return (
    <div className="flex gap-1.5">
      <Button size="icon" onClick={undo} disabled={!canUndo} aria-label="Отменить">
        <Undo2 size={19} />
      </Button>
      <Button size="icon" onClick={() => sceneBridge.refit()} aria-label="Показать всю миссию">
        <Maximize2 size={18} />
      </Button>
      <Button size="icon" onClick={() => openSettings(true)} aria-label="Настройки">
        <Settings size={19} />
      </Button>
    </div>
  )
}
