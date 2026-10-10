/** Draft geometry for the level constructor (tools/design.ts). Final numbers live in src/game/levels/levels.ts. */
import type { BodyId } from '../src/game/levels/catalog'
import type { LevelDef } from '../src/game/levels/types'
import type { Plan } from '../src/game/rules/plan'

export interface Placement {
  id: BodyId
  dir: 'out' | 'in'
  /** angular offset of the planet from the ship's crossing point, rad (+ = planet ahead) */
  offset: number
  after?: number
}

export interface Draft {
  level: LevelDef
  plan: Plan
  placements: Placement[]
}

const plan = (launchTime: number, prograde: number, radial = 0, nodes: Plan['nodes'] = []): Plan => ({
  launchTime,
  launch: { prograde, radial },
  nodes,
})

const base = (over: Partial<LevelDef>): LevelDef => ({
  id: 'X',
  number: 0,
  title: '',
  summary: '',
  briefing: '',
  difficulty: 1,
  bodies: [],
  start: { kind: 'docked', bodyId: 'aqua', launchWindow: [0, 0] },
  target: { bodyId: 'rubra', kind: 'flyby', zoneRadius: 0.12 },
  budget: 1,
  maxBurns: 3,
  maxFlightTime: null,
  horizon: 30,
  stars: { dvForTwo: 1, dvForThree: 1, timeForThree: 100 },
  initialPlan: plan(0, 0.05),
  solution: plan(0, 0.05),
  hints: ['', '', ''],
  camera: { x: 0, y: 0, radius: 3 },
  ...over,
})

const b = (id: BodyId, phaseDeg: number) => ({ id, phaseDeg })

export const DRAFTS: Draft[] = [
  {
    level: base({
      id: 'L1',
      title: 'Первый импульс',
      bodies: [b('cinder', 40), b('aqua', 210), b('rubra', 260), b('colossus', 120), b('aurum', 300), b('borey', 160)],
      target: { bodyId: 'rubra', kind: 'flyby', zoneRadius: 0.12 },
      budget: 0.16,
      maxBurns: 1,
      maxFlightTime: 6,
      horizon: 6.5,
    }),
    plan: plan(0, 0.124),
    placements: [{ id: 'rubra', dir: 'out', offset: 0 }],
  },
  {
    level: base({
      id: 'L2',
      title: 'Планеты движутся',
      bodies: [b('cinder', 200), b('aqua', 150), b('rubra', 320), b('colossus', 0), b('aurum', 250), b('borey', 60)],
      start: { kind: 'docked', bodyId: 'aqua', launchWindow: [0, 12] },
      target: { bodyId: 'colossus', kind: 'flyby', zoneRadius: 0.3 },
      budget: 0.235,
      maxBurns: 1,
      maxFlightTime: 7,
      horizon: 7.5,
    }),
    plan: plan(6.2, 0.212),
    placements: [{ id: 'colossus', dir: 'out', offset: 0.02 }],
  },
  {
    level: base({
      id: 'L3',
      title: 'Первая праща',
      bodies: [b('cinder', 0), b('aqua', 190), b('rubra', 100), b('colossus', 0), b('aurum', 0), b('borey', 230)],
      start: { kind: 'docked', bodyId: 'aqua', launchWindow: [0, 10] },
      target: { bodyId: 'aurum', kind: 'flyby', zoneRadius: 0.3 },
      budget: 0.25,
      maxBurns: 2,
      maxFlightTime: 9.5,
      horizon: 10,
    }),
    plan: plan(3.0, 0.232),
    placements: [
      { id: 'colossus', dir: 'out', offset: 0.1 },
      { id: 'aurum', dir: 'out', offset: 0, after: 1 },
    ],
  },
  {
    level: base({
      id: 'L4',
      title: 'Тормозящий манёвр',
      bodies: [b('cinder', 0), b('aqua', 0), b('rubra', 300), b('colossus', 0), b('aurum', 200), b('borey', 120)],
      start: { kind: 'orbit', state: { x: 2.1, y: 3.6373, vx: -0.4132, vy: 0.1058 }, launchWindow: [0, 0] },
      target: { bodyId: 'aqua', kind: 'flyby', zoneRadius: 0.2 },
      budget: 0.06,
      maxBurns: 2,
      maxFlightTime: 12.5,
      horizon: 13,
    }),
    plan: { launchTime: 0, launch: { prograde: 0, radial: 0 }, nodes: [{ id: 'a', dt: 1.5, prograde: -0.03, radial: 0 }] },
    placements: [
      { id: 'colossus', dir: 'in', offset: -0.1 },
      { id: 'aqua', dir: 'in', offset: 0, after: 0 },
    ],
  },
  {
    level: base({
      id: 'L5',
      title: 'Два сближения',
      bodies: [
        b('cinder', 0), b('aqua', 200), b('rubra', 60), b('colossus', 0), b('aurum', 0), b('borey', 90), b('viola', 0),
      ],
      start: { kind: 'docked', bodyId: 'aqua', launchWindow: [0, 10] },
      target: { bodyId: 'viola', kind: 'flyby', zoneRadius: 0.3 },
      budget: 0.28,
      maxBurns: 3,
      maxFlightTime: 16,
      horizon: 16.5,
    }),
    plan: plan(2.0, 0.258),
    placements: [
      { id: 'colossus', dir: 'out', offset: 0.1 },
      { id: 'aurum', dir: 'out', offset: 0.06, after: 1 },
      { id: 'viola', dir: 'out', offset: 0, after: 1 },
    ],
  },
]
