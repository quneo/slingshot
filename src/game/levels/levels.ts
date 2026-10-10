/**
 * Campaign «Учебная система Лира». Planet phases were produced by tools/design.ts (planets are placed where a
 * reference plan actually flies), budgets and stars were calibrated with tools/optimize.ts.
 * Every `solution` is replayed by tests/levels.test.ts — a level ships only if its solution wins.
 */
import type { Plan } from '../rules/plan'
import type { LevelDef } from './types'

const launchPlan = (launchTime: number, prograde: number, radial = 0): Plan => ({
  launchTime,
  launch: { prograde, radial },
  nodes: [],
})

export const LEVELS: LevelDef[] = [
  {
    id: 'L1',
    number: 1,
    title: 'Первый импульс',
    summary: 'Долететь до Рубры одним импульсом',
    briefing: 'Корабль ждёт на Акве. Задайте импульс старта так, чтобы прогноз прошёл через кольцо вокруг Рубры.',
    difficulty: 1,
    bodies: [
      { id: 'cinder', phaseDeg: 40 },
      { id: 'aqua', phaseDeg: 210 },
      { id: 'rubra', phaseDeg: 258.0982784 },
      { id: 'colossus', phaseDeg: 120 },
      { id: 'aurum', phaseDeg: 300 },
      { id: 'borey', phaseDeg: 160 },
    ],
    start: { kind: 'docked', bodyId: 'aqua', launchWindow: [0, 0] },
    target: { bodyId: 'rubra', kind: 'flyby', zoneRadius: 0.12 },
    budget: 0.16,
    maxBurns: 1,
    maxFlightTime: 6,
    horizon: 6.5,
    stars: { dvForTwo: 0.13, dvForThree: 0.115, timeForThree: 5 },
    initialPlan: launchPlan(0, 0.06),
    solution: launchPlan(0, 0.124),
    hints: [
      'Импульс вперёд, по ходу движения Аквы, поднимает орбиту — корабль уходит дальше от звезды.',
      'Цельтесь не в Рубру, а в место встречи: на карте показано, где она будет, когда вы долетите.',
      'Около 3,5 км/с почти точно вперёд хватит с запасом.',
    ],
    hintBody: 'rubra',
    tutorial: ['drag-impulse', 'read-forecast', 'launch'],
    camera: { x: 0.1, y: -0.4, radius: 1.75 },
  },
  {
    id: 'L2',
    number: 2,
    title: 'Планеты движутся',
    summary: 'Поймать Колосс в правильное окно старта',
    briefing: 'Колосс далеко и движется медленнее Аквы. Выберите дату старта, чтобы встретить его в точке прибытия.',
    difficulty: 2,
    bodies: [
      { id: 'cinder', phaseDeg: 200 },
      { id: 'aqua', phaseDeg: 150 },
      { id: 'rubra', phaseDeg: 320 },
      { id: 'colossus', phaseDeg: 141.5158125 },
      { id: 'aurum', phaseDeg: 250 },
      { id: 'borey', phaseDeg: 60 },
    ],
    start: { kind: 'docked', bodyId: 'aqua', launchWindow: [0, 12] },
    target: { bodyId: 'colossus', kind: 'flyby', zoneRadius: 0.3 },
    budget: 0.22,
    maxBurns: 1,
    maxFlightTime: 7,
    horizon: 7.5,
    stars: { dvForTwo: 0.19, dvForThree: 0.17, timeForThree: 6.6 },
    initialPlan: launchPlan(0, 0.2),
    solution: launchPlan(6.2, 0.212),
    hints: [
      'Перелёт к внешней планете длится месяцы — за это время она уходит вперёд по орбите.',
      'Стартуйте, когда Колосс опережает Акву примерно на четверть круга.',
      'Подходящее окно старта подсвечено на шкале даты старта.',
    ],
    hintBody: 'colossus',
    hintWindow: [5.3, 6.8],
    tutorial: ['launch-window'],
    camera: { x: -0.3, y: -0.4, radius: 2.9 },
  },
  {
    id: 'L3',
    number: 3,
    title: 'Первая праща',
    summary: 'Добраться до Аурума через пролёт у Колосса',
    briefing:
      'На прямой перелёт к Ауруму топлива не хватит. Пролетите позади Колосса — его гравитация разгонит корабль бесплатно.',
    difficulty: 3,
    bodies: [
      { id: 'cinder', phaseDeg: 0 },
      { id: 'aqua', phaseDeg: 190 },
      { id: 'rubra', phaseDeg: 100 },
      { id: 'colossus', phaseDeg: 43.6102996 },
      { id: 'aurum', phaseDeg: 99.3359584 },
      { id: 'borey', phaseDeg: 230 },
    ],
    start: { kind: 'docked', bodyId: 'aqua', launchWindow: [0, 10] },
    target: { bodyId: 'aurum', kind: 'flyby', zoneRadius: 0.3 },
    budget: 0.24,
    maxBurns: 2,
    maxFlightTime: 9.5,
    horizon: 10,
    stars: { dvForTwo: 0.225, dvForThree: 0.215, timeForThree: 8.7 },
    initialPlan: launchPlan(0, 0.2),
    solution: launchPlan(3, 0.232),
    hints: [
      'Пролёт позади планеты, по ходу её движения, разгоняет корабль относительно звезды. Топливо на это не тратится.',
      'Используйте Колосс: пройдите позади него, в паре его радиусов от поверхности.',
      'Подходящее окно старта подсвечено на шкале даты старта.',
    ],
    hintBody: 'colossus',
    hintWindow: [2.4, 3.2],
    tutorial: ['flyby', 'add-node'],
    camera: { x: -0.8, y: 1.0, radius: 3.6 },
  },
  {
    id: 'L4',
    number: 4,
    title: 'Тормозящий манёвр',
    summary: 'Затормозить о Колосс и вернуться к Акве',
    briefing:
      'Зонд возвращается с окраины системы почти без топлива. Пролёт перед Колоссом погасит лишнюю скорость — направьте зонд к Акве.',
    difficulty: 4,
    bodies: [
      { id: 'cinder', phaseDeg: 0 },
      { id: 'aqua', phaseDeg: 253.687555 },
      { id: 'rubra', phaseDeg: 300 },
      { id: 'colossus', phaseDeg: 6.5687254 },
      { id: 'aurum', phaseDeg: 200 },
      { id: 'borey', phaseDeg: 120 },
    ],
    start: { kind: 'orbit', state: { x: 2.1, y: 3.6373, vx: -0.4132, vy: 0.1058 }, launchWindow: [0, 0] },
    target: { bodyId: 'aqua', kind: 'flyby', zoneRadius: 0.2 },
    budget: 0.03,
    maxBurns: 2,
    maxFlightTime: 12.5,
    horizon: 13,
    stars: { dvForTwo: 0.016, dvForThree: 0.012, timeForThree: 12.5 },
    initialPlan: { launchTime: 0, launch: { prograde: 0, radial: 0 }, nodes: [] },
    solution: { launchTime: 0, launch: { prograde: 0, radial: 0 }, nodes: [{ id: 'ref', dt: 1.5, prograde: -0.03, radial: 0 }] },
    hints: [
      'Пролёт перед планетой, навстречу её движению, отнимает у корабля энергию — орбита опускается ближе к звезде.',
      'Сейчас зонд проходит слишком далеко от Колосса. Небольшой импульс против движения сдвинет встречу.',
      'Хватит меньше 1 км/с назад, в первые 100 дней полёта.',
    ],
    hintBody: 'colossus',
    camera: { x: 0.3, y: 1.3, radius: 3.6 },
  },
  {
    id: 'L5',
    number: 5,
    title: 'Два сближения',
    summary: 'Дотянуться до Виолы двумя пращами',
    briefing: 'Виола на краю системы, а лимит времени жёсткий. Используйте и Колосс, и Аурум — два разгона подряд.',
    difficulty: 5,
    bodies: [
      { id: 'cinder', phaseDeg: 0 },
      { id: 'aqua', phaseDeg: 200 },
      { id: 'rubra', phaseDeg: 60 },
      { id: 'colossus', phaseDeg: 7.3992368 },
      { id: 'aurum', phaseDeg: 53.1944205 },
      { id: 'borey', phaseDeg: 90 },
      { id: 'viola', phaseDeg: 99.4981848 },
    ],
    start: { kind: 'docked', bodyId: 'aqua', launchWindow: [0, 8] },
    target: { bodyId: 'viola', kind: 'flyby', zoneRadius: 0.3 },
    budget: 0.28,
    maxBurns: 3,
    maxFlightTime: 16,
    horizon: 16.5,
    stars: { dvForTwo: 0.262, dvForThree: 0.25, timeForThree: 15.5 },
    initialPlan: launchPlan(0, 0.24),
    solution: launchPlan(2, 0.258),
    hints: [
      'Каждый пролёт позади планеты добавляет скорость. Два пролёта подряд дают ещё больше.',
      'Сначала Колосс, затем Аурум. После первого пролёта курс можно подправить коррекцией.',
      'Подходящее окно старта подсвечено на шкале даты старта.',
    ],
    hintBody: 'colossus',
    hintWindow: [1.9, 2.2],
    camera: { x: -1.4, y: 2.0, radius: 5.6 },
  },
]

const BY_ID = new Map(LEVELS.map((l) => [l.id, l]))

export function getLevel(id: string): LevelDef {
  const level = BY_ID.get(id)
  if (!level) throw new Error(`Unknown level ${id}`)
  return level
}

export function nextLevel(id: string): LevelDef | null {
  const i = LEVELS.findIndex((l) => l.id === id)
  return i >= 0 && i < LEVELS.length - 1 ? LEVELS[i + 1] : null
}
