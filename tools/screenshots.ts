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
  launched: ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'],
  levels: {
    c1: { done: true, stars: 3, best: 2500 },
    c2: { done: true, stars: 2, best: 2140 },
    c3: { done: true, stars: 3, best: 3010 },
    c4: { done: true, stars: 1, best: 1620 },
    c5: { done: true, stars: 3, best: 4870 },
  },
}

const wait = (page: Page, ms: number) => page.waitForTimeout(ms)

async function fresh(page: Page) {
  await page.addInitScript(`localStorage.setItem('slingshot:casual', ${JSON.stringify(JSON.stringify(SAVE))})`)
  await page.goto(BASE)
  await page.waitForFunction('!!window.__renderer')
  await wait(page, 2500)
}

async function open(page: Page, id: string) {
  await page.evaluate(`window.__casual.setState({ unlockAll: true }); window.__casual.getState().openLevel(${JSON.stringify(id)})`)
  await page.waitForFunction('!window.__renderer.camera.animating')
  await wait(page, 300)
}

/** Holds the slingshot pulled at `k` × the reference throw (rotated by `turn` radians) without letting go. */
async function pull(page: Page, k = 1, turn = 0) {
  await page.evaluate(`(() => {
    const r = window.__renderer, s = window.__session(), L = s.level
    const max = Math.min(210, Math.max(110, Math.min(innerWidth, innerHeight) * 0.3))
    const c = Math.cos(${turn}), sn = Math.sin(${turn})
    const dvx = (L.reference.dvx * c - L.reference.dvy * sn) * ${k}
    const dvy = (L.reference.dvx * sn + L.reference.dvy * c) * ${k}
    window.__pull = { x: r.shipX, y: r.shipY, px: -dvx / L.power * max, py: dvy / L.power * max }
  })()`)
  const p = (await page.evaluate('window.__pull')) as { x: number; y: number; px: number; py: number }
  await page.mouse.move(p.x, p.y)
  await page.mouse.down()
  for (let i = 1; i <= 12; i++) await page.mouse.move(p.x + (p.px * i) / 12, p.y + (p.py * i) / 12)
  await wait(page, 400)
  return p
}

async function shoot(page: Page, name: string) {
  await page.screenshot({ path: `${OUT}/${name}.png` })
  console.log('saved', name)
}

/** Plays the reference throw and stops the picture when a caption with `text` appears. */
async function flyUntilPopup(page: Page, id: string, text: string) {
  await open(page, id)
  await pull(page)
  await page.mouse.up()
  await page.waitForFunction(`window.__renderer.fx.popups.some((p) => p.text.includes(${JSON.stringify(text)}) && p.age > 0.25)`, null, {
    timeout: 60_000,
  })
}

async function run() {
  const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'msedge' })

  const desk = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await fresh(desk)
  await wait(desk, 2500)
  await shoot(desk, 'desktop-1-menu')

  await open(desk, 'c5')
  await pull(desk, 0.99)
  await shoot(desk, 'desktop-2-aim')
  await desk.mouse.up()

  await flyUntilPopup(desk, 'c9', 'ПРАЩА')
  await shoot(desk, 'desktop-3-slingshot')

  // a boost being charged: time slows down, the arrow and the new path show where it will push
  await open(desk, 'c6')
  await pull(desk)
  await desk.mouse.up()
  await wait(desk, 1800)
  const ship = (await desk.evaluate('({ x: window.__renderer.shipX, y: window.__renderer.shipY })')) as { x: number; y: number }
  await desk.mouse.move(ship.x - 120, ship.y - 90)
  await desk.mouse.down()
  await wait(desk, 500)
  await shoot(desk, 'desktop-4-boost')
  await desk.mouse.up()

  await open(desk, 'c12')
  await pull(desk)
  await desk.mouse.up()
  await desk.waitForSelector('[role="dialog"]', { timeout: 60_000 })
  await wait(desk, 2200)
  await shoot(desk, 'desktop-5-result')

  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  await fresh(phone)
  await wait(phone, 2500)
  await shoot(phone, 'phone-1-menu')
  await open(phone, 'c8')
  await pull(phone, 0.99)
  await shoot(phone, 'phone-2-aim')
  await phone.mouse.up()
  await flyUntilPopup(phone, 'c5', 'ПРАЩА')
  await shoot(phone, 'phone-3-slingshot')

  await browser.close()
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
