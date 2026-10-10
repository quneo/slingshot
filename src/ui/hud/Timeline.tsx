import { useRef, type PointerEvent as ReactPointerEvent } from 'react'
import { getLevel } from '../../game/levels/levels'
import { sortedNodes } from '../../game/rules/plan'
import { useGame } from '../../state/gameStore'
import { forecastRef } from '../../state/prediction'
import { cn } from '@/lib/utils'
import { days } from '../format'

interface Marker {
  t: number
  kind: 'burn' | 'flyby' | 'arrival' | 'collision' | 'miss'
  id?: string
  label: string
}

const DOT: Record<Marker['kind'], string> = {
  burn: 'bg-trail border-space',
  flyby: 'bg-assist border-space',
  arrival: 'bg-go border-space',
  collision: 'bg-danger border-space',
  miss: 'bg-space border-danger',
}

/**
 * Mission time scrubber for planning: drag to see where planets and the ship will be; drag a burn marker to
 * move that burn in time.
 */
export function Timeline({ className, compact = false }: { className?: string; compact?: boolean }) {
  const level = getLevel(useGame((s) => s.levelId))
  const plan = useGame((s) => s.plan)
  const viewTime = useGame((s) => s.viewTime)
  const setViewTime = useGame((s) => s.setViewTime)
  const updateNode = useGame((s) => s.updateNode)
  const addNode = useGame((s) => s.addNode)
  const select = useGame((s) => s.select)
  const beginGesture = useGame((s) => s.beginGesture)
  const endGesture = useGame((s) => s.endGesture)
  useGame((s) => s.forecast.version)
  const track = useRef<HTMLDivElement>(null)
  const dragging = useRef<{ kind: 'cursor' } | { kind: 'node'; id: string } | null>(null)

  const t0 = plan.launchTime
  const span = level.horizon
  const fc = forecastRef.current
  const result = fc?.levelId === level.id ? fc.result : null

  const markers: Marker[] = []
  sortedNodes(plan).forEach((n, i) => markers.push({ t: t0 + n.dt, kind: 'burn', id: n.id, label: `Коррекция ${i + 2}` }))
  if (result) {
    for (const f of result.flybys) if (f.complete) markers.push({ t: f.t, kind: 'flyby', label: 'Гравитационный манёвр' })
    if (result.arrival) markers.push({ t: result.arrival.t, kind: 'arrival', label: 'Прибытие' })
    else if (result.collision) markers.push({ t: result.collision.t, kind: 'collision', label: 'Столкновение' })
  }

  const pct = (t: number) => `${Math.min(100, Math.max(0, ((t - t0) / span) * 100))}%`
  const timeAt = (clientX: number) => {
    const r = track.current!.getBoundingClientRect()
    return t0 + Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * span
  }

  const onDown = (e: ReactPointerEvent, target: { kind: 'cursor' } | { kind: 'node'; id: string }) => {
    e.stopPropagation()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    dragging.current = target
    if (target.kind === 'node') {
      beginGesture()
      select({ kind: 'node', id: target.id })
    } else setViewTime(timeAt(e.clientX))
  }
  const onMove = (e: ReactPointerEvent) => {
    const d = dragging.current
    if (!d) return
    const t = timeAt(e.clientX)
    if (d.kind === 'node') {
      updateNode(d.id, { dt: t - t0 })
      setViewTime(t)
    } else setViewTime(t)
  }
  const onUp = () => {
    if (dragging.current?.kind === 'node') endGesture()
    dragging.current = null
  }

  const endT = result?.endTime ?? t0 + span
  return (
    <div className={cn('panel-quiet', compact ? 'px-3 pb-1 pt-1.5' : 'px-4 pb-2 pt-2.5', className)} data-inset="bottom">
      <div className="mb-1 flex items-baseline justify-between text-[12px]">
        <span className="font-semibold text-ink-2">Время полёта</span>
        <span className="num font-bold">
          {viewTime < t0 ? `до старта ${days(t0 - viewTime)} дн.` : `${days(viewTime - t0)}-й день`}
          <span className="font-semibold text-ink-2"> из {days(span)}</span>
        </span>
      </div>
      <div
        ref={track}
        className="relative h-7 cursor-pointer touch-none"
        onPointerDown={(e) => onDown(e, { kind: 'cursor' })}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onDoubleClick={(e) => addNode(timeAt(e.clientX) - t0)}
        title="Двойной щелчок — коррекция в это время"
        role="slider"
        aria-label="Время на карте"
        aria-valuemin={0}
        aria-valuemax={days(span)}
        aria-valuenow={days(viewTime - t0)}
        tabIndex={0}
        onKeyDown={(e) => {
          const step = span / 60
          if (e.key === 'ArrowRight') setViewTime(Math.min(t0 + span, viewTime + step))
          if (e.key === 'ArrowLeft') setViewTime(Math.max(t0, viewTime - step))
        }}
      >
        <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-line/70" />
        <div className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-trail/45" style={{ left: 0, width: pct(endT) }} />
        {level.maxFlightTime !== null && (
          <div className="absolute inset-y-0.5 w-0 border-l-2 border-dashed border-assist/80" style={{ left: pct(t0 + level.maxFlightTime) }} title="Лимит полёта" />
        )}
        {markers.map((m, i) => (
          <div
            key={`${m.kind}-${m.id ?? i}`}
            className={cn(
              'absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2',
              DOT[m.kind],
              m.kind === 'burn' && 'h-4 w-4 cursor-ew-resize ring-2 ring-trail/30',
            )}
            style={{ left: pct(m.t) }}
            title={`${m.label}: ${days(m.t - t0)}-й день`}
            onPointerDown={m.kind === 'burn' && m.id ? (e) => onDown(e, { kind: 'node', id: m.id! }) : undefined}
          />
        ))}
        <div className="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 rounded bg-ink" style={{ left: pct(Math.max(t0, viewTime)) }}>
          <div className="absolute -top-0.5 left-1/2 h-2 w-2 -translate-x-1/2 rotate-45 bg-ink" />
        </div>
      </div>
    </div>
  )
}
