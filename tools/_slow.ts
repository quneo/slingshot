import { getLevel } from '../src/game/levels/levels'
import { predict } from '../src/game/worker/predict'
for (const id of ['L1', 'L2', 'L3', 'L4', 'L5', 'L6']) {
  const l = getLevel(id)
  let worst = { ms: 0, steps: 0, samples: 0, end: '', m: 0, a: 0 }
  let total = 0, n = 0
  for (let m = 0; m <= l.budget * 1.0001; m += l.budget / 12) {
    for (let a = -180; a < 180; a += 15) {
      const plan = { ...l.initialPlan, launch: { prograde: m * Math.cos((a * Math.PI) / 180), radial: m * Math.sin((a * Math.PI) / 180) } }
      const t0 = performance.now()
      const r = predict(1, id, plan)
      const ms = performance.now() - t0
      total += ms; n++
      if (ms > worst.ms) worst = { ms: +ms.toFixed(1), steps: r.result.steps, samples: r.result.sampleCount, end: r.result.endReason, m: +m.toFixed(4), a }
    }
  }
  console.log(id, 'avg', (total / n).toFixed(2), 'ms; worst', JSON.stringify(worst))
}
