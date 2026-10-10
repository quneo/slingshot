import { ArrowRight, Loader2, Play, Plus, Rocket, Spline } from 'lucide-react'
import { Fragment, useState } from 'react'
import { CATALOG } from '../../game/levels/catalog'
import { getLevel } from '../../game/levels/levels'
import { TOURS } from '../../game/levels/tours'
import { checkPlan } from '../../game/rules/evaluate'
import { impulseMagnitude, sortedNodes } from '../../game/rules/plan'
import { forecastRef } from '../../state/prediction'
import { useGame } from '../../state/gameStore'
import { cn } from '@/lib/utils'
import { Button } from '../components/button'
import { genitive } from '../../game/rendering/scene'
import { days, kmsNumber, plural } from '../format'
import { PlanetThumb } from './MissionCard'
import { BurnEditor } from './BurnEditor'

function RouteCard({
  index,
  title,
  sub,
  dv,
  selected,
  warn,
  onClick,
  icon,
}: {
  index: number
  title: string
  sub: string
  dv: number
  selected: boolean
  warn?: boolean
  onClick: () => void
  icon: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        'flex h-[58px] shrink-0 items-center gap-2.5 rounded-2xl border px-3 text-left transition-[border-color,background-color] duration-150',
        selected ? 'border-trail bg-trail/10 shadow-[0_0_0_3px_rgba(77,207,245,0.12)]' : 'border-line/80 bg-space/40 hover:border-trail/50',
        warn && 'border-danger/70',
      )}
    >
      {icon}
      <span
        className={cn(
          'num grid h-6 w-6 shrink-0 place-items-center rounded-full border text-[12px] font-extrabold',
          selected ? 'border-trail text-trail' : 'border-ink-2/60 text-ink-2',
        )}
      >
        {index}
      </span>
      <span className="flex flex-col leading-tight">
        <span className="text-[13.5px] font-bold">{title}</span>
        <span className={cn('num text-[12px]', warn ? 'text-danger' : 'text-ink-2')}>{sub}</span>
      </span>
      <span className="num ml-1 text-[13px] font-bold text-trail">{kmsNumber(dv, 2)}</span>
    </button>
  )
}

export function LaunchButton({ className }: { className?: string }) {
  const level = getLevel(useGame((s) => s.levelId))
  const plan = useGame((s) => s.plan)
  const launch = useGame((s) => s.launch)
  const queued = useGame((s) => s.launchQueued)
  const valid = checkPlan(level, plan).length === 0
  return (
    <Button variant="go" size="xl" className={cn('min-w-[180px] shrink-0', className)} onClick={launch} disabled={!valid} data-tour="launch">
      {queued ? <Loader2 className="animate-spin" size={24} aria-hidden /> : <Play className="fill-current" size={24} aria-hidden />}
      Пуск
    </Button>
  )
}

/** Bottom panel: the route as a sequence of burns, the editor of the selected one, and the launch button. */
export function RouteDock({ compact = false }: { compact?: boolean }) {
  const level = getLevel(useGame((s) => s.levelId))
  const tour = useGame((s) => s.tour)
  // phones keep the map large; the editor opens on tap, or right away when the tour points into it
  const tourUsesEditor = !!tour && (TOURS[tour.key] ?? []).some((st) => st.anchor && 'dom' in st.anchor && ['editor', 'launch-date'].includes(st.anchor.dom))
  const [editorOpen, setEditorOpen] = useState(!compact || tourUsesEditor)
  const plan = useGame((s) => s.plan)
  const selection = useGame((s) => s.selection)
  const select = useGame((s) => s.select)
  const addNode = useGame((s) => s.addNode)
  const viewTime = useGame((s) => s.viewTime)
  useGame((s) => s.forecast.version)
  const nodes = sortedNodes(plan)
  const canAdd = 1 + nodes.length < level.maxBurns
  const unexecuted = new Set(forecastRef.current?.outcome.unexecutedNodeIds ?? [])
  const home = level.start.kind === 'docked' ? CATALOG[level.start.bodyId] : null
  const launchSub =
    level.start.kind !== 'docked'
      ? 'в полёте'
      : level.start.launchWindow[1] > level.start.launchWindow[0]
        ? `${days(plan.launchTime)}-й день`
        : `с ${genitive(home!.name)}`

  const addAtCursor = () => {
    setEditorOpen(true)
    const end = forecastRef.current?.result.endTime ?? plan.launchTime + level.horizon
    const span = end - plan.launchTime
    const dt = viewTime > plan.launchTime + 0.05 ? viewTime - plan.launchTime : span * 0.3
    addNode(dt)
  }

  return (
    <section
      className={cn('panel', compact ? 'p-3' : 'px-5 py-4 [@media(max-height:860px)]:py-3')}
      data-inset="bottom"
      data-tour="route"
      aria-label="Маршрут"
    >
      <div className="flex items-center gap-4">
        {!compact && (
          <div className="w-[104px] shrink-0">
            <div className="text-[19px] font-extrabold leading-tight">Маршрут</div>
            <div className="text-[12.5px] text-ink-2">
              {1 + nodes.length} из {level.maxBurns} {plural(level.maxBurns, 'импульса', 'импульсов', 'импульсов')}
            </div>
          </div>
        )}
        <div className="scroll-x -my-1 flex min-w-0 flex-1 items-center gap-2 py-1">
          <RouteCard
            index={1}
            title={level.start.kind === 'docked' ? 'Старт' : 'Импульс сейчас'}
            sub={launchSub}
            dv={impulseMagnitude(plan.launch)}
            selected={selection?.kind === 'launch'}
            onClick={() => {
              setEditorOpen((o) => (selection?.kind === 'launch' ? !o : true))
              select({ kind: 'launch' })
            }}
            icon={home ? <PlanetThumb id={home.id} size={30} /> : <Rocket size={22} className="text-trail" aria-hidden />}
          />
          {nodes.map((n, i) => (
            <Fragment key={n.id}>
              <ArrowRight size={16} className="shrink-0 text-ink-3" aria-hidden />
              <RouteCard
                index={i + 2}
                title="Коррекция"
                sub={unexecuted.has(n.id) ? 'не успеет сработать' : `${days(n.dt)}-й день`}
                warn={unexecuted.has(n.id)}
                dv={impulseMagnitude(n)}
                selected={selection?.kind === 'node' && selection.id === n.id}
                onClick={() => {
                  setEditorOpen((o) => (selection?.kind === 'node' && selection.id === n.id ? !o : true))
                  select({ kind: 'node', id: n.id })
                }}
                icon={<Spline size={22} className="text-trail" aria-hidden />}
              />
            </Fragment>
          ))}
          {canAdd && (
            <>
              <ArrowRight size={16} className="shrink-0 text-ink-3" aria-hidden />
              <button
                type="button"
                onClick={addAtCursor}
                data-tour="add-node"
                aria-label="Добавить коррекцию"
                className="flex h-[58px] shrink-0 items-center gap-2 rounded-2xl border border-dashed border-line px-4 text-[13px] font-semibold text-ink-2 transition-colors duration-150 hover:border-trail/60 hover:text-ink"
              >
                <Plus size={18} aria-hidden />
                {!compact && (
                  <span className="leading-tight">
                    Добавить
                    <br />
                    коррекцию
                  </span>
                )}
              </button>
            </>
          )}
        </div>
        <LaunchButton className={compact ? 'h-[58px] min-w-0 px-4 text-[18px]' : undefined} />
      </div>
      {selection && editorOpen && (
        <div className={cn('hairline border-t', compact ? 'mt-2.5 pt-2.5' : 'mt-3 pt-3')} data-tour="editor">
          <BurnEditor compact={compact} />
        </div>
      )}
    </section>
  )
}
