import { ArrowDownLeft, ArrowLeft, ArrowRight, ArrowUpRight, Minus, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { CATALOG } from '../../game/levels/catalog'
import { getLevel } from '../../game/levels/levels'
import { fromDays, fromKms, toDays, toKms } from '../../game/physics/units'
import { impulseMagnitude, type Impulse } from '../../game/rules/plan'
import { availableFor, useGame } from '../../state/gameStore'
import { cn } from '@/lib/utils'
import { Button } from '../components/button'
import { Slider } from '../components/slider'
import { days } from '../format'

const toImpulse = (magKms: number, angleDeg: number): Impulse => {
  const m = fromKms(Math.max(0, magKms))
  const a = (angleDeg * Math.PI) / 180
  return { prograde: m * Math.cos(a), radial: m * Math.sin(a) }
}

const angleDeg = (i: Impulse) => (impulseMagnitude(i) > 0 ? (Math.atan2(i.radial, i.prograde) * 180) / Math.PI : 0)

function directionWord(deg: number): string {
  const a = ((deg % 360) + 540) % 360 - 180
  if (Math.abs(a) < 3) return 'вперёд'
  if (Math.abs(a) > 177) return 'назад'
  if (Math.abs(a - 90) < 3) return 'от звезды'
  if (Math.abs(a + 90) < 3) return 'к звезде'
  return a > 0 ? (a < 90 ? 'вперёд и наружу' : 'назад и наружу') : a > -90 ? 'вперёд и внутрь' : 'назад и внутрь'
}

/** Number field with − / + buttons; commits on Enter / blur. */
function Stepper({
  label,
  value,
  unit,
  step,
  digits,
  onChange,
  min,
  max,
  wide,
  fluid,
}: {
  label: string
  value: number
  unit: string
  step: number
  digits: number
  onChange: (v: number) => void
  min?: number
  max?: number
  wide?: boolean
  fluid?: boolean
}) {
  const [text, setText] = useState(value.toFixed(digits).replace('.', ','))
  useEffect(() => setText(value.toFixed(digits).replace('.', ',')), [value, digits])
  const clamp = (v: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v))
  const commit = () => {
    if (text === value.toFixed(digits).replace('.', ',')) return
    const v = Number(text.replace(',', '.'))
    if (Number.isFinite(v)) onChange(clamp(v))
    else setText(value.toFixed(digits).replace('.', ','))
  }
  return (
    <label className={cn('flex flex-col gap-1', fluid && 'min-w-0 flex-1')}>
      <span className="text-[12px] font-semibold text-ink-2">{label}</span>
      <span className="flex h-10 items-center rounded-xl border border-line bg-space/60">
        <button
          type="button"
          className="grid h-full w-9 place-items-center rounded-l-xl text-ink-2 hover:bg-white/5 hover:text-ink"
          onClick={() => onChange(clamp(value - step))}
          aria-label={`${label}: меньше`}
        >
          <Minus size={15} />
        </button>
        <input
          className={cn(
            'num h-full min-w-0 bg-transparent text-center text-[15px] font-bold outline-none',
            fluid ? 'flex-1' : wide ? 'w-[72px]' : 'w-[58px]',
          )}
          inputMode="decimal"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          aria-label={label}
        />
        <span className="pr-1 text-[12px] text-ink-2">{unit}</span>
        <button
          type="button"
          className="grid h-full w-9 place-items-center rounded-r-xl text-ink-2 hover:bg-white/5 hover:text-ink"
          onClick={() => onChange(clamp(value + step))}
          aria-label={`${label}: больше`}
        >
          <Plus size={15} />
        </button>
      </span>
    </label>
  )
}

function DirButton({ label, onClick, children, active }: { label: string; onClick: () => void; children: ReactNode; active: boolean }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={cn(
        'grid h-10 w-10 place-items-center rounded-xl border transition-colors duration-150',
        active ? 'border-go/70 bg-go/15 text-go' : 'border-line text-ink-2 hover:border-trail/60 hover:text-ink',
      )}
    >
      {children}
    </button>
  )
}

/** Precise editing of the selected burn: magnitude, direction, time (and launch date). */
export function BurnEditor({ compact = false }: { compact?: boolean }) {
  const level = getLevel(useGame((s) => s.levelId))
  const plan = useGame((s) => s.plan)
  const selection = useGame((s) => s.selection)
  const setLaunchImpulse = useGame((s) => s.setLaunchImpulse)
  const setLaunchTime = useGame((s) => s.setLaunchTime)
  const updateNode = useGame((s) => s.updateNode)
  const removeNode = useGame((s) => s.removeNode)
  const beginGesture = useGame((s) => s.beginGesture)
  const endGesture = useGame((s) => s.endGesture)
  const hintStep = useGame((s) => s.hintStep)

  /** one slider drag = one undo step; ends on release even if the value never changed */
  const startSliderGesture = () => {
    beginGesture()
    const end = () => {
      endGesture()
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
    }
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
  }

  if (!selection) return null
  const node = selection.kind === 'node' ? plan.nodes.find((n) => n.id === selection.id) : null
  if (selection.kind === 'node' && !node) return null
  const impulse: Impulse = node ?? plan.launch
  const mag = toKms(impulseMagnitude(impulse))
  const ang = angleDeg(impulse)
  const max = toKms(impulseMagnitude(impulse) + availableFor(level, plan, selection))
  const apply = (i: Impulse) => (node ? updateNode(node.id, i) : setLaunchImpulse(i))
  const [w0, w1] = level.start.launchWindow
  const launchAdjustable = selection.kind === 'launch' && w1 > w0
  const dirs: [string, number, ReactNode][] = [
    ['Вперёд, по ходу движения', 0, <ArrowRight size={17} key="f" />],
    ['От звезды', 90, <ArrowUpRight size={17} key="o" />],
    ['К звезде', -90, <ArrowDownLeft size={17} key="i" />],
    ['Назад, против движения', 180, <ArrowLeft size={17} key="b" />],
  ]
  const title = selection.kind === 'launch' ? (level.start.kind === 'docked' ? `Старт с ${genitiveOf(level.start.bodyId)}` : 'Импульс сейчас') : 'Коррекция'

  const magnitudeStepper = (
    <Stepper label="Импульс" value={mag} unit="км/с" step={0.05} digits={2} min={0} max={max} fluid={compact} onChange={(v) => apply(toImpulse(v, ang))} />
  )
  const angleStepper = (
    <Stepper
      label="Угол к курсу"
      value={Math.round(ang)}
      unit="°"
      step={5}
      digits={0}
      min={-180}
      max={180}
      fluid={compact}
      // a zero vector has no direction: give it a small magnitude so the chosen angle sticks
      onChange={(v) => apply(toImpulse(Math.max(mag, 0.1), v))}
    />
  )
  const directions = (
    <div className="flex gap-1.5">
      {dirs.map(([label, a, icon]) => (
        <DirButton key={label} label={label} active={mag > 0 && Math.abs(ang - a) < 0.5} onClick={() => apply(toImpulse(Math.max(mag, 0.1), a))}>
          {icon}
        </DirButton>
      ))}
    </div>
  )
  const timeControl = node && (
    <div className={cn('flex flex-col gap-1', compact ? 'w-full' : 'min-w-[200px] flex-1')}>
      <span className="flex justify-between text-[12px] font-semibold text-ink-2">
        <span>Время импульса</span>
        <span className="num text-ink">{days(node.dt)}-й день полёта</span>
      </span>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="iconSm" aria-label="На день раньше" onClick={() => updateNode(node.id, { dt: node.dt - fromDays(1) })}>
          <Minus size={15} />
        </Button>
        <Slider
          min={0.02}
          max={level.horizon - 0.01}
          step={fromDays(1)}
          value={[node.dt]}
          onValueChange={([v]) => updateNode(node.id, { dt: v })}
          onPointerDown={startSliderGesture}
          aria-label="Время импульса"
        />
        <Button variant="outline" size="iconSm" aria-label="На день позже" onClick={() => updateNode(node.id, { dt: node.dt + fromDays(1) })}>
          <Plus size={15} />
        </Button>
      </div>
    </div>
  )
  const dateControl = launchAdjustable && (
    <div className={cn('flex flex-col gap-1', compact ? 'w-full' : 'min-w-[220px] flex-1')}>
      <span className="flex justify-between text-[12px] font-semibold text-ink-2">
        <span>Дата старта</span>
        <span className="num text-ink">
          {days(plan.launchTime)}-й день
          {hintStep >= 3 && level.hintWindow && (
            <span className="text-gold">
              {' '}
              (окно {Math.round(toDays(level.hintWindow[0]))}–{Math.round(toDays(level.hintWindow[1]))})
            </span>
          )}
        </span>
      </span>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="iconSm" aria-label="Стартовать на день раньше" onClick={() => setLaunchTime(plan.launchTime - fromDays(1))}>
          <Minus size={15} />
        </Button>
        <Slider
          min={w0}
          max={w1}
          step={fromDays(1)}
          value={[plan.launchTime]}
          onValueChange={([v]) => setLaunchTime(v)}
          onPointerDown={startSliderGesture}
          aria-label="Дата старта"
          trackOverlay={
            hintStep >= 3 && level.hintWindow ? (
              <span
                className="absolute inset-y-0 bg-gold/70"
                style={{
                  left: `${((level.hintWindow[0] - w0) / (w1 - w0)) * 100}%`,
                  width: `${((level.hintWindow[1] - level.hintWindow[0]) / (w1 - w0)) * 100}%`,
                }}
              />
            ) : null
          }
        />
        <Button variant="outline" size="iconSm" aria-label="Стартовать на день позже" onClick={() => setLaunchTime(plan.launchTime + fromDays(1))}>
          <Plus size={15} />
        </Button>
      </div>
    </div>
  )
  const removeOrReset = node ? (
    <Button variant="danger" size={compact ? 'icon' : 'md'} onClick={() => removeNode(node.id)} aria-label="Удалить коррекцию">
      <Trash2 size={16} aria-hidden />
      {!compact && 'Удалить'}
    </Button>
  ) : (
    <Button
      variant="ghost"
      size={compact ? 'icon' : 'md'}
      onClick={() => setLaunchImpulse({ prograde: 0, radial: 0 })}
      disabled={mag === 0}
      aria-label="Обнулить импульс"
    >
      <RotateCcw size={16} aria-hidden />
      {!compact && 'Обнулить'}
    </Button>
  )

  if (compact) {
    return (
      <div className="space-y-2.5">
        <div className="flex gap-2">
          {magnitudeStepper}
          {angleStepper}
        </div>
        <div className="flex items-center gap-1.5">
          {directions}
          <span className="ml-1 min-w-0 flex-1 truncate text-[12px] text-ink-2">{directionWord(ang)}</span>
          {removeOrReset}
        </div>
        {timeControl}
        {dateControl}
      </div>
    )
  }

  return (
    <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
      <div className="flex w-[118px] flex-col">
        <span className="text-[12px] font-semibold text-ink-2">Редактор</span>
        <span className="text-[15px] font-extrabold leading-tight">{title}</span>
        <span className="text-[12px] text-ink-2">{directionWord(ang)}</span>
      </div>
      {magnitudeStepper}
      {angleStepper}
      <div className="flex flex-col gap-1">
        <span className="text-[12px] font-semibold text-ink-2">Направление</span>
        {directions}
      </div>
      {timeControl}
      {dateControl}
      <div className="ml-auto flex gap-1.5">{removeOrReset}</div>
    </div>
  )
}

const GEN: Record<string, string> = { aqua: 'Аквы', rubra: 'Рубры', colossus: 'Колосса', aurum: 'Аурума', borey: 'Борея', viola: 'Виолы', cinder: 'Пепла', lyra: 'Лиры' }
const genitiveOf = (id: keyof typeof CATALOG) => GEN[id] ?? CATALOG[id].name
