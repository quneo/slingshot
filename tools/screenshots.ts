/**
 * Captures the key screens into docs/screenshots (drives the dev server's debug handles).
 *   npx vite --port 5318 &   then   npx tsx tools/screenshots.ts
 * Page scripts are passed as strings: tsx would wrap functions in helpers the page does not have.
 */
import { mkdirSync } from 'node:fs'
import { chromium, type Page } from '@playwright/test'

const BASE = process.env.BASE_URL ?? 'http://localhost:5318'
const OUT = 'docs/screenshots'
mkdirSync(OUT, { recursive: true })

const SAVE = {
  version: 1,
  muted: true,
  launched: ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9', 'm10', 'm11', 'm12'],
  missions: {
    m1: { done: true, stars: 3, bestSpent: 0.18 },
    m2: { done: true, stars: 2, bestSpent: 0.45 },
    m3: { done: true, stars: 3, bestSpent: 0.42 },
    m4: { done: true, stars: 1, bestSpent: 0.63 },
    m5: { done: true, stars: 3, bestSpent: 0.17 },
  },
}

const wait = (page: Page, ms: number) => page.waitForTimeout(ms)

async function fresh(page: Page) {
  await page.addInitScript(`localStorage.setItem('slingshot:orbits', ${JSON.stringify(JSON.stringify(SAVE))})`)
  await page.goto(BASE)
  await page.waitForFunction('!!window.__renderer')
  await wait(page, 2500)
}

async function open(page: Page, id: string) {
  await page.evaluate(`window.__casual.setState({ unlockAll: true }); window.__casual.getState().openLevel(${JSON.stringify(id)})`)
  await page.waitForFunction('!window.__renderer.camera.animating')
  await wait(page, 300)
}

/** Puts the clock `offset` from the current hop's window and holds the reference pull without letting go. */
async function pull(page: Page, offset = 0) {
  await page.evaluate(`(() => {
    const r = window.__renderer, s = window.__session(), ref = s.mission.hops[s.hopIndex].reference
    s.t = s.checkpoint.t + ref.wait + ${offset}
    const max = Math.min(210, Math.max(110, Math.min(innerWidth, innerHeight) * 0.3))
    window.__pull = { x: r.anchorX, y: r.anchorY, px: -ref.dvx / s.mission.power * max, py: ref.dvy / s.mission.power * max }
  })()`)
  const p = (await page.evaluate('window.__pull')) as { x: number; y: number; px: number; py: number }
  await page.mouse.move(p.x, p.y)
  await page.mouse.down()
  for (let i = 1; i <= 6; i++) await page.mouse.move(p.x + (p.px * i) / 6, p.y + (p.py * i) / 6)
  await page.evaluate(`window.__session().t = window.__session().checkpoint.t + window.__session().mission.hops[window.__session().hopIndex].reference.wait + ${offset}`)
  await wait(page, 500)
}

async function shoot(page: Page, name: string) {
  await page.screenshot({ path: `${OUT}/${name}.png` })
  console.log('saved', name)
}

async function run() {
  const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'msedge' })

  const desk = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await fresh(desk)
  await wait(desk, 3000)
  await shoot(desk, 'desktop-1-menu')

  // the window: the copy of Rubra glows green where the ship will meet it
  await open(desk, 'm1')
  await pull(desk)
  await shoot(desk, 'desktop-2-window')
  // the same pull too early: a miss, and the windows chart says how long to wait
  await pull(desk, -1.2)
  await shoot(desk, 'desktop-3-miss')
  await desk.mouse.move(10, 10)
  await desk.evaluate(`window.__session().clearAim()`)
  await desk.mouse.up()

  // a slingshot on the way to Aurum
  await open(desk, 'm6')
  await pull(desk)
  await desk.mouse.up()
  await desk.waitForFunction(`window.__renderer.fx.popups.some((p) => p.text.includes('ПРАЩА') && p.age > 0.25)`, null, { timeout: 60_000 })
  await shoot(desk, 'desktop-4-slingshot')

  // a multi-hop mission: second hop of three, route chips and the tank already lighter
  await open(desk, 'm9')
  await pull(desk)
  await desk.mouse.up()
  await desk.waitForFunction(`window.__session().hopIndex === 1 && window.__session().phase === 'parked'`, null, { timeout: 60_000 })
  await desk.waitForFunction('!window.__renderer.camera.animating')
  await pull(desk)
  await shoot(desk, 'desktop-5-second-hop')
  await desk.mouse.up()

  await open(desk, 'm1')
  await pull(desk)
  await desk.mouse.up()
  await desk.waitForSelector('[role="dialog"]', { timeout: 60_000 })
  await wait(desk, 2000)
  await shoot(desk, 'desktop-6-result')

  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  await fresh(phone)
  await wait(phone, 3000)
  await shoot(phone, 'phone-1-menu')
  await open(phone, 'm3')
  await pull(phone)
  await shoot(phone, 'phone-2-window')
  await phone.mouse.up()
  await phone.waitForFunction(`window.__session().phase === 'capture'`, null, { timeout: 60_000 })
  await wait(phone, 400)
  await shoot(phone, 'phone-3-capture')

  await browser.close()
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
