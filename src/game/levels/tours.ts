/**
 * Guided tutorials: short tours that point at real things on screen and wait for the player to do them.
 * Keys are `<levelId>:plan` / `<levelId>:flight`; `controls` is the general tour offered from the help dialog.
 */

/** Something on screen a step points at: a HUD element (`data-tour` attribute) or a point on the map. */
export type TourAnchor =
  | { dom: string; fallback?: TourAnchor }
  | { map: 'home' | 'target' | 'helper' | 'handle' | 'ship' | 'path' }
  | null

/** What ends a step: the "Далее" button, or the player doing the thing. */
export type TourWait = 'next' | 'impulse-changed' | 'date-changed' | 'node-added' | 'success' | 'launched'

export interface TourStep {
  anchor: TourAnchor
  title: string
  body: string
  wait: TourWait
  /** animated hint of the gesture to make */
  gesture?: 'drag' | 'tap'
}

const step = (s: TourStep): TourStep => s

export const TOURS: Record<string, TourStep[]> = {
  'L1:plan': [
    step({
      anchor: { map: 'home' },
      title: 'Это ваш корабль',
      body: 'Он стоит на Акве и ждёт старта. Задача — долететь до Рубры одним толчком двигателя.',
      wait: 'next',
    }),
    step({
      anchor: { map: 'target' },
      title: 'Цель — Рубра',
      body: 'Нужно пролететь через жёлтое кольцо вокруг неё. Планеты движутся: полупрозрачная копия показывает, где Рубра будет, когда вы долетите.',
      wait: 'next',
    }),
    step({
      anchor: { map: 'handle' },
      gesture: 'drag',
      title: 'Потяните зелёную стрелку',
      body: 'Это импульс двигателя. Длина — сила толчка, направление — куда толкнуть корабль. Возьмитесь за кружок на конце и потяните.',
      wait: 'impulse-changed',
    }),
    step({
      anchor: { map: 'path' },
      title: 'Пунктир — прогноз полёта',
      body: 'Он пересчитывается сразу, пока вы тянете. Доведите его до жёлтого кольца у Рубры: подсказка в карточке миссии скажет, чего не хватает.',
      wait: 'success',
    }),
    step({
      anchor: { dom: 'dv-meter' },
      title: 'Бюджет Δv',
      body: 'Столько скорости двигатель может добавить за всю миссию. Потратите меньше — получите больше звёзд.',
      wait: 'next',
    }),
    step({
      anchor: { dom: 'editor', fallback: { dom: 'route' } },
      title: 'Точная настройка',
      body: 'Те же сила и направление — числами. «Угол к курсу» 0° — вперёд по ходу движения, 180° — назад. Стрелки справа задают направление одним нажатием.',
      wait: 'next',
    }),
    step({
      anchor: { dom: 'timeline' },
      title: 'Шкала времени',
      body: 'Потяните её, чтобы увидеть, где будут планеты и корабль в любой день полёта.',
      wait: 'next',
    }),
    step({
      anchor: { dom: 'launch' },
      title: 'Пуск!',
      body: 'Прогноз попадает в цель. Нажмите «Пуск» и посмотрите полёт.',
      wait: 'launched',
    }),
  ],
  'L1:flight': [
    step({
      anchor: { dom: 'speed' },
      title: 'Скорость времени',
      body: '×1, ×10, ×100 — как быстро идёт полёт. Рядом пауза и переход к следующему событию.',
      wait: 'next',
    }),
    step({
      anchor: { dom: 'camera' },
      title: 'Камера',
      body: 'Авто-камера показывает весь путь и приближается к планетам во время пращи. Колесо мыши или щипок — масштаб.',
      wait: 'next',
    }),
  ],
  'L2:plan': [
    step({
      anchor: { map: 'target' },
      title: 'Планеты движутся',
      body: 'Колосс далеко и идёт по орбите медленнее Аквы. Если стартовать сейчас, к месту встречи он не успеет.',
      wait: 'next',
    }),
    step({
      anchor: { dom: 'launch-date', fallback: { dom: 'route' } },
      title: 'Выберите дату старта',
      body: 'Двигайте ползунок даты. Подсказка в карточке миссии скажет, на сколько дней сдвинуть старт.',
      wait: 'success',
    }),
  ],
  'L3:plan': [
    step({
      anchor: { map: 'helper' },
      title: 'Гравитационная праща',
      body: 'Пролетая позади планеты по ходу её движения, корабль ускоряется — топливо на это не тратится. Только так до Аурума хватит бюджета.',
      wait: 'next',
    }),
    step({
      anchor: { dom: 'forecast' },
      title: 'Подсказка ведёт к праще',
      body: 'Она скажет, как вы разминулись с Колоссом и на сколько сдвинуть старт. Удачная праща — янтарный участок пути у Колосса.',
      wait: 'success',
    }),
  ],
  'L4:plan': [
    step({
      anchor: { map: 'ship' },
      title: 'Зонд уже в полёте',
      body: 'Он возвращается с окраины системы почти без топлива и сейчас промахивается мимо Аквы.',
      wait: 'next',
    }),
    step({
      anchor: { map: 'path' },
      gesture: 'tap',
      title: 'Поставьте коррекцию',
      body: 'Нажмите на пунктир в начале пути — там появится новый импульс.',
      wait: 'node-added',
    }),
    step({
      anchor: { map: 'handle' },
      gesture: 'drag',
      title: 'Тормозите',
      body: 'Потяните новую стрелку назад, против движения. Пролёт перед Колоссом погасит лишнюю скорость.',
      wait: 'success',
    }),
  ],
  'L5:plan': [
    step({
      anchor: { dom: 'forecast' },
      title: 'Две пращи подряд',
      body: 'Сначала Колосс, потом Аурум. Подсказка скажет, как поймать первую.',
      wait: 'next',
    }),
  ],
  'L6:plan': [
    step({
      anchor: { map: 'target' },
      title: 'Встреча, а не пролёт',
      body: 'В кольце Рубры скорость относительно неё должна быть меньше 1,2 км/с. Одним импульсом так не выйдет.',
      wait: 'next',
    }),
    step({
      anchor: { dom: 'add-node', fallback: { map: 'path' } },
      gesture: 'tap',
      title: 'Второй импульс',
      body: 'Добавьте коррекцию — кнопкой или нажатием на пунктир — и поставьте её туда, где путь подходит к орбите Рубры.',
      wait: 'node-added',
    }),
    step({
      anchor: { dom: 'forecast' },
      title: 'Уравняйте скорость',
      body: 'Тяните стрелку коррекции вперёд и следите за подсказкой: она показывает, какая разница скоростей осталась.',
      wait: 'success',
    }),
  ],
  controls: [
    step({
      anchor: { map: 'handle' },
      gesture: 'drag',
      title: 'Импульс',
      body: 'Зелёная стрелка — толчок двигателя: длина — сила, направление — куда. Тяните кружок на конце.',
      wait: 'next',
    }),
    step({
      anchor: { map: 'path' },
      gesture: 'tap',
      title: 'Коррекция',
      body: 'Нажмите на пунктир, чтобы поставить ещё один импульс в этой точке пути (если миссия разрешает).',
      wait: 'next',
    }),
    step({
      anchor: { dom: 'editor', fallback: { dom: 'route' } },
      title: 'Точные числа',
      body: 'Сила, угол к курсу, время импульса и дата старта — в редакторе маршрута.',
      wait: 'next',
    }),
    step({
      anchor: { dom: 'timeline' },
      title: 'Время',
      body: 'Шкала показывает, где будут планеты и корабль в любой день. Двойной щелчок по ней ставит коррекцию.',
      wait: 'next',
    }),
    step({
      anchor: { dom: 'forecast' },
      title: 'Подсказка',
      body: 'Здесь честный вердикт прогноза: попадаете ли вы и что поменять, если нет.',
      wait: 'next',
    }),
    step({
      anchor: { dom: 'launch' },
      title: 'Пуск',
      body: 'Когда прогноз попадает в цель — запускайте. Колесо или щипок меняют масштаб карты, перетаскивание — сдвигает.',
      wait: 'next',
    }),
  ],
}

export const tourKey = (levelId: string, phase: 'plan' | 'flight') => `${levelId}:${phase}`
