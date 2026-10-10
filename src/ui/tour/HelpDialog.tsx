import { CalendarClock, GraduationCap, Keyboard, Move, MousePointerClick, Orbit, Rocket, Settings, Spline, ZoomIn } from 'lucide-react'
import type { ReactNode } from 'react'
import { TOURS, tourKey } from '../../game/levels/tours'
import { useGame } from '../../state/gameStore'
import { Button } from '../components/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../components/dialog'

function Item({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-trail/10 text-trail">{icon}</span>
      <div>
        <div className="font-bold">{title}</div>
        <div className="text-[13px] leading-snug text-ink-2">{children}</div>
      </div>
    </div>
  )
}

/** "How do I play?" — every control in one place, and a way to replay the guided tour. */
export function HelpDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const screen = useGame((s) => s.screen)
  const levelId = useGame((s) => s.levelId)
  const startTour = useGame((s) => s.startTour)
  const openSettings = useGame((s) => s.setSettingsOpen)
  const levelTour = tourKey(levelId, 'plan')
  const tourToStart = screen === 'mission' ? (TOURS[levelTour] ? levelTour : 'controls') : null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(560px,calc(100vw-24px))] max-h-[calc(100dvh-24px)] overflow-y-auto">
        <DialogTitle>Как управлять</DialogTitle>
        <DialogDescription>Вы задаёте только толчки двигателя — остальное делает гравитация.</DialogDescription>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Item icon={<Move size={18} />} title="Импульс">
            Тяните зелёный кружок на конце стрелки. Длина — сила, направление — куда толкнуть. Точные числа — в редакторе
            внизу.
          </Item>
          <Item icon={<Spline size={18} />} title="Прогноз">
            Пунктир — путь с учётом притяжения всех планет. Янтарный участок — праща. Бледная линия — где бы вы были без
            неё.
          </Item>
          <Item icon={<MousePointerClick size={18} />} title="Коррекция">
            Нажмите на пунктир — в этой точке появится ещё один импульс. Его время двигается ползунком или точкой на шкале.
          </Item>
          <Item icon={<CalendarClock size={18} />} title="Время и дата старта">
            Шкала «Время полёта» показывает, где будут планеты в любой день. Дата старта — ползунок в редакторе старта.
          </Item>
          <Item icon={<Orbit size={18} />} title="Праща">
            Пролёт позади планеты, по ходу её движения, разгоняет; перед ней — тормозит. Пунктирный круг у гиганта —
            зона, где он ощутимо тянет.
          </Item>
          <Item icon={<ZoomIn size={18} />} title="Карта">
            Колесо мыши или щипок — масштаб, перетаскивание — сдвиг. Кнопки сверху: вся миссия и к кораблю.
          </Item>
          <Item icon={<Rocket size={18} />} title="Полёт">
            ×1/×10/×100 — скорость времени, пауза, переход к следующему событию, выбор камеры.
          </Item>
          <Item icon={<Keyboard size={18} />} title="Клавиши">
            Ctrl+Z — отмена, Enter — пуск, Delete — удалить коррекцию, пробел — пауза, Esc — к маршруту.
          </Item>
        </div>
        <div className="mt-5 flex flex-col gap-2 sm:flex-row">
          {tourToStart && (
            <Button
              variant="go"
              size="lg"
              className="flex-1"
              onClick={() => {
                onOpenChange(false)
                startTour(tourToStart)
              }}
            >
              <GraduationCap size={18} aria-hidden />
              Показать обучение ещё раз
            </Button>
          )}
          <Button
            size="lg"
            onClick={() => {
              onOpenChange(false)
              openSettings(true)
            }}
          >
            <Settings size={18} aria-hidden />
            Настройки
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
