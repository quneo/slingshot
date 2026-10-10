/** Measures how often the forecast updates during a realistic 125 Hz handle drag (dev server on 5318).
 *   npx vite --port 5318 &  then  npx tsx tools/measure-drag.ts */
import { chromium } from '@playwright/test'
const DRAG = `(async () => {
  const w = globalThis
  const h = w.__scene.scene.hits.handle
  const canvas = document.querySelector('canvas')
  const r = canvas.getBoundingClientRect()
  const updates = []
  const pred = await import('/src/state/prediction.ts')
  const computes = []
  const longTasks = []
  const po = new PerformanceObserver((list) => { for (const e of list.getEntries()) longTasks.push(Math.round(e.duration)) })
  po.observe({ entryTypes: ['longtask'] })
  const unsub = w.__game.subscribe((s, p) => { if (s.forecast.version !== p.forecast.version) { updates.push(performance.now()); computes.push(Math.round(pred.forecastRef.current.computeMs)) } })
  const ev = (type, x, y) => canvas.dispatchEvent(new PointerEvent(type, { clientX: r.left + x, clientY: r.top + y, pointerId: 1, pointerType: 'mouse', bubbles: true, buttons: type === 'pointerup' ? 0 : 1 }))
  ev('pointerdown', h.tx, h.ty)
  const start = performance.now()
  for (let i = 1; i <= 125; i++) {
    ev('pointermove', h.tx + i * 0.6, h.ty + i * 0.8)
    await new Promise((res) => setTimeout(res, 8))
  }
  const dragMs = performance.now() - start
  const during = updates.length
  let gap = updates.length ? updates[0] - start : dragMs
  for (let i = 1; i < updates.length; i++) gap = Math.max(gap, updates[i] - updates[i - 1])
  ev('pointerup', h.tx + 75, h.ty + 100)
  await new Promise((res) => setTimeout(res, 300))
  unsub()
  po.disconnect()
  const gaps = updates.map((u, i) => (i ? Math.round(u - updates[i - 1]) : 0)).slice(1).sort((a, b) => b - a).slice(0, 6)
  return { worstCompute: computes.sort((a, b) => b - a).slice(0, 5), longTasks: longTasks.sort((a, b) => b - a).slice(0, 8), topGaps: gaps, dragMs: Math.round(dragMs), updatesDuringDrag: during, totalAfterRelease: updates.length, maxGapMs: Math.round(gap) }
})()`
const browser = await chromium.launch({ channel: 'msedge' })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await page.addInitScript(() => localStorage.setItem('slingshot:save', JSON.stringify({ version: 1, settings: {}, progress: {}, tutorialDone: ['L1', 'L5'] })))
await page.goto(process.env.URL ?? 'http://localhost:5318')
await page.waitForFunction('!!(globalThis.__scene && globalThis.__scene.scene)')
for (const level of ['L1', 'L5']) {
  await page.evaluate(`globalThis.__game.getState().startLevel('${level}')`)
  await page.waitForTimeout(2500)
  console.log(level, JSON.stringify(await page.evaluate(DRAG)))
}
await browser.close()
