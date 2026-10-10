import { ChevronLeft, Hand, X } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { TOURS, type TourAnchor, type TourStep } from '../../game/levels/tours'
import { planKey } from '../../game/rules/plan'
import { useGame } from '../../state/gameStore'
import { cn } from '@/lib/utils'
import { Button } from '../components/button'
import { sceneBridge, type MapAnchor } from '../sceneBridge'
import { useCompact } from '../useMedia'

/** how far the drag hint travels, px */
const DRAG_PX = 80

interface Spot {
  x: number
  y: number
  w: number
  h: number
  /** round highlight for map points */
  round: boolean
  /** for the drag hint: direction of the arrow (screen, unit) */
  dir?: { x: number; y: number }
}

function domRect(key: string): DOMRect | null {
  for (const el of document.querySelectorAll<HTMLElement>(`[data-tour="${key}"]`)) {
    const r = el.getBoundingClientRect()
    if (r.width > 0 && r.height > 0) return r
  }
  return null
}

function resolve(anchor: TourAnchor): Spot | null {
  if (!anchor) return null
  if ('dom' in anchor) {
    const r = domRect(anchor.dom)
    if (r) return { x: r.left - 6, y: r.top - 6, w: r.width + 12, h: r.height + 12, round: false }
    return anchor.fallback ? resolve(anchor.fallback) : null
  }
  const a: MapAnchor | null = sceneBridge.anchor(anchor.map)
  if (!a) return null
  const r = Math.max(a.r + 12, 26)
  return { x: a.x - r, y: a.y - r, w: r * 2, h: r * 2, round: true, dir: a.dir }
}

/** Has the player done what the step asks? */
function useStepDone(step: TourStep | undefined, startKey: string): boolean {
  const plan = useGame((s) => s.plan)
  const forecast = useGame((s) => s.forecast)
  const phase = useGame((s) => s.phase)
  const start = useRef<{ launch: string; launchTime: number; nodes: number } | null>(null)
  useEffect(() => {
    const p = useGame.getState().plan
    start.current = { launch: JSON.stringify(p.launch), launchTime: p.launchTime, nodes: p.nodes.length }
  }, [startKey])
  if (!step || !start.current) return false
  const fresh = forecast.key === planKey(plan)
  switch (step.wait) {
    case 'impulse-changed':
      return JSON.stringify(plan.launch) !== start.current.launch
    case 'date-changed':
      return plan.launchTime !== start.current.launchTime
    case 'node-added':
      return plan.nodes.length > start.current.nodes
    case 'success':
      return fresh && !!forecast.outcome?.success
    case 'launched':
      return phase !== 'plan'
    default:
      return false
  }
}

/**
 * Guided tour: dims the screen except the thing a step talks about, shows the gesture to make, and moves on
 * when the player has done it. It never blocks the game — everything stays clickable underneath.
 */
export function Tour() {
  const compact = useCompact()
  const tour = useGame((s) => s.tour)
  const advance = useGame((s) => s.advanceTour)
  const finish = useGame((s) => s.finishTour)
  const steps = tour ? (TOURS[tour.key] ?? []) : []
  const step = tour ? steps[tour.step] : undefined
  const stepKey = tour ? `${tour.key}#${tour.step}` : ''
  const done = useStepDone(step, stepKey)
  const [spot, setSpot] = useState<Spot | null>(null)
  const [viewport, setViewport] = useState({ w: window.innerWidth, h: window.innerHeight })
  const card = useRef<HTMLDivElement>(null)
  const [cardSize, setCardSize] = useState({ w: 360, h: 180 })

  // follow the anchor every frame (the map moves, panels resize)
  useEffect(() => {
    if (!step) return
    let raf = 0
    let last = ''
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const s = resolve(step.anchor)
      const sig = s ? `${Math.round(s.x)},${Math.round(s.y)},${Math.round(s.w)},${Math.round(s.h)}` : 'none'
      if (sig !== last) {
        last = sig
        setSpot(s)
        setViewport({ w: window.innerWidth, h: window.innerHeight })
      }
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [step])

  useLayoutEffect(() => {
    if (card.current) setCardSize({ w: card.current.offsetWidth, h: card.current.offsetHeight })
  }, [stepKey, spot === null])

  // action steps complete themselves — also when the next step is already satisfied on arrival
  useEffect(() => {
    if (done) {
      const t = setTimeout(advance, 450)
      return () => clearTimeout(t)
    }
  }, [done, advance, stepKey])

  if (!tour || !step) return null

  const pad = 12
  const { w: vw, h: vh } = viewport
  const cw = cardSize.w
  const ch = cardSize.h
  let left = (vw - cw) / 2
  let top = compact ? pad : vh * 0.18
  if (spot) {
    const cx = spot.x + spot.w / 2
    const cy = spot.y + spot.h / 2
    // keep clear of the highlight and of the path the gesture hint travels along
    const reach = step.gesture === 'drag' && spot.dir ? { x: cx + spot.dir.x * DRAG_PX, y: cy + spot.dir.y * DRAG_PX } : { x: cx, y: cy }
    const avoid = {
      x: Math.min(spot.x, reach.x - 24),
      y: Math.min(spot.y, reach.y - 24),
      r: Math.max(spot.x + spot.w, reach.x + 24),
      b: Math.max(spot.y + spot.h, reach.y + 24),
    }
    const fits = (l: number, t: number) =>
      l >= pad && t >= pad && l + cw <= vw - pad && t + ch <= vh - pad && (l + cw <= avoid.x || l >= avoid.r || t + ch <= avoid.y || t >= avoid.b)
    const centeredX = Math.min(vw - cw - pad, Math.max(pad, cx - cw / 2))
    const centeredY = Math.min(vh - ch - pad, Math.max(pad, cy - ch / 2))
    const candidates: [number, number][] = compact
      ? [
          [pad, avoid.b + pad],
          [pad, avoid.y - pad - ch],
          [pad, vh - ch - pad - 150],
          [pad, 70],
        ]
      : [
          [centeredX, avoid.b + pad],
          [centeredX, avoid.y - pad - ch],
          [avoid.r + pad, centeredY],
          [avoid.x - pad - cw, centeredY],
        ]
    const found = candidates.find(([l, t]) => fits(l, t)) ?? candidates[0]
    left = compact ? (vw - cw) / 2 : found[0]
    top = found[1]
  }
  left = Math.min(vw - cw - pad, Math.max(pad, left))
  top = Math.min(vh - ch - pad, Math.max(pad, top))

  const action = step.wait !== 'next'
  return (
    <div className="pointer-events-none fixed inset-0 z-30" aria-live="polite">
      {/* dim everything except the spot */}
      <svg className="absolute inset-0 h-full w-full animate-fade" aria-hidden>
        <defs>
          <mask id="tour-hole">
            <rect width="100%" height="100%" fill="white" />
            {spot &&
              (spot.round ? (
                <circle cx={spot.x + spot.w / 2} cy={spot.y + spot.h / 2} r={spot.w / 2} fill="black" />
              ) : (
                <rect x={spot.x} y={spot.y} width={spot.w} height={spot.h} rx={16} fill="black" />
              ))}
          </mask>
        </defs>
        <rect width="100%" height="100%" fill="rgba(3, 7, 18, 0.5)" mask="url(#tour-hole)" />
        {spot &&
          (spot.round ? (
            <circle
              cx={spot.x + spot.w / 2}
              cy={spot.y + spot.h / 2}
              r={spot.w / 2}
              fill="none"
              stroke="#4DCFF5"
              strokeWidth="2.5"
              className="tour-pulse"
            />
          ) : (
            <rect x={spot.x} y={spot.y} width={spot.w} height={spot.h} rx={16} fill="none" stroke="#4DCFF5" strokeWidth="2.5" className="tour-pulse" />
          ))}
      </svg>

      {spot && step.gesture && <GestureHint spot={spot} kind={step.gesture} />}

      <div
        ref={card}
        className={cn('panel pointer-events-auto absolute w-[min(380px,calc(100vw-24px))] p-4 animate-rise', compact && 'rounded-2xl')}
        style={{ left, top }}
        role="dialog"
        aria-label={step.title}
        key={stepKey}
      >
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="text-[16px] font-extrabold text-trail">{step.title}</h3>
              <span className="num shrink-0 text-[12px] text-ink-2">
                {tour.step + 1} / {steps.length}
              </span>
            </div>
            <p className="mt-1 text-[13.5px] leading-snug text-ink">{step.body}</p>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2">
          {action ? (
            <span className={cn('flex-1 text-[12.5px] font-semibold', done ? 'text-go' : 'text-gold')}>
              {done ? 'Отлично!' : step.wait === 'launched' ? 'Нажмите «Пуск»' : 'Сделайте это — обучение продолжится само'}
            </span>
          ) : (
            <span className="flex-1" />
          )}
          {tour.step > 0 && !action && (
            <Button size="sm" variant="ghost" onClick={() => useGame.setState({ tour: { key: tour.key, step: tour.step - 1 } })} aria-label="Назад">
              <ChevronLeft size={16} />
            </Button>
          )}
          {action ? (
            <Button size="sm" variant="ghost" onClick={advance}>
              Пропустить шаг
            </Button>
          ) : (
            <Button size="sm" variant="go" className="min-w-[96px]" onClick={advance}>
              {tour.step + 1 >= steps.length ? 'Понятно' : 'Далее'}
            </Button>
          )}
        </div>
        <button
          className="absolute -right-2 -top-2 grid h-7 w-7 place-items-center rounded-full border border-line bg-panel text-ink-2 hover:text-ink"
          onClick={finish}
          aria-label="Закрыть обучение"
          title="Закрыть обучение"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  )
}

/** A hand that shows the gesture: dragging the arrow tip outwards (with a dotted "pull here" arrow), or tapping. */
function GestureHint({ spot, kind }: { spot: Spot; kind: 'drag' | 'tap' }) {
  const cx = spot.x + spot.w / 2
  const cy = spot.y + spot.h / 2
  const dir = spot.dir ?? { x: 0.7, y: 0.7 }
  const ex = cx + dir.x * DRAG_PX
  const ey = cy + dir.y * DRAG_PX
  const style = {
    left: cx,
    top: cy,
    '--dx': `${dir.x * DRAG_PX}px`,
    '--dy': `${dir.y * DRAG_PX}px`,
  } as React.CSSProperties
  const head = Math.atan2(dir.y, dir.x)
  return (
    <>
      {kind === 'drag' && (
        <svg className="absolute inset-0 h-full w-full" aria-hidden>
          <line x1={cx + dir.x * 16} y1={cy + dir.y * 16} x2={ex} y2={ey} stroke="#37DCA0" strokeWidth="2.5" strokeDasharray="5 6" strokeLinecap="round" />
          <polygon
            points="0,-7 12,0 0,7"
            fill="#37DCA0"
            transform={`translate(${ex} ${ey}) rotate(${(head * 180) / Math.PI})`}
          />
        </svg>
      )}
      <div className={cn('absolute', kind === 'drag' ? 'tour-drag' : 'tour-tap')} style={style} aria-hidden>
        <Hand size={34} className="-translate-x-1 -translate-y-1 fill-ink/90 text-space drop-shadow-[0_2px_6px_rgba(0,0,0,0.6)]" />
      </div>
    </>
  )
}
