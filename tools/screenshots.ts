/**
 * Captures the key screens into docs/screenshots (uses the dev server's debug handles).
 *   npx vite --port 5318 &   then   npx tsx tools/screenshots.ts
 */
import { mkdirSync } from 'node:fs'
import { chromium, type Page } from '@playwright/test'

const BASE = process.env.BASE_URL ?? 'http://localhost:5318'
const OUT = 'docs/screenshots'
mkdirSync(OUT, { recursive: true })

type Win = typeof globalThis & {
  __game: { getState: () => Record<string, (...a: unknown[]) => unknown> & { phase: string } }
  __clock: { seek: (t: number) => void; endTime: number; playing: boolean }
}

const wait = (page: Page, ms: number) => page.waitForTimeout(ms)

async function fresh(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem(
      'slingshot:save',
      JSON.stringify({
        version: 1,
        settings: { unlockAll: true },
        progress: {
          L1: { completed: true, stars: 3, best: { success: true, stars: 3, spentDv: 0.1, flightTime: 4.5, at: 0 }, attempts: [], lastPlan: null },
          L2: { completed: true, stars: 2, best: { success: true, stars: 2, spentDv: 0.18, flightTime: 6.2, at: 0 }, attempts: [], lastPlan: null },
        },
        tutorialDone: ['L2', 'L3', 'L4', 'L5'],
      }),
    )
  })
  await page.goto(BASE)
  await page.waitForFunction(() => 'scene' in ((globalThis as unknown as { __scene?: object }).__scene ?? {}) && !!(globalThis as unknown as { __scene: { scene: unknown } }).__scene.scene)
  await wait(page, 1500)
}

async function plan(page: Page, level: string, launchTime: number, prograde: number, radial = 0) {
  await page.evaluate(
    ([level, launchTime, prograde, radial]) => {
      const g = (globalThis as unknown as Win).__game.getState()
      g.startLevel(level)
      const s = (globalThis as unknown as Win).__game.getState()
      s.setLaunchTime(launchTime)
      s.setLaunchImpulse({ prograde, radial })
    },
    [level, launchTime, prograde, radial] as const,
  )
  await wait(page, 1600)
}

async function shoot(page: Page, name: string) {
  await page.screenshot({ path: `${OUT}/${name}.png` })
  console.log('saved', name)
}

async function run() {
  const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'msedge' })

  // desktop
  const desk = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
  await fresh(desk)
  await desk.evaluate(() => (globalThis as unknown as Win).__game.getState().selectMenuLevel('L3'))
  await wait(desk, 800)
  await shoot(desk, 'desktop-1-missions')

  await plan(desk, 'L1', 0, 0.06)
  await shoot(desk, 'desktop-2-plan-miss')
  await plan(desk, 'L3', 3, 0.232)
  await shoot(desk, 'desktop-3-plan-slingshot')

  await desk.evaluate(() => {
    const w = globalThis as unknown as Win
    w.__game.getState().launch()
  })
  await wait(desk, 400)
  await desk.evaluate(() => {
    const w = globalThis as unknown as Win
    w.__clock.seek(7.25)
    w.__game.getState().setFlightSpeed(1)
  })
  await wait(desk, 2600)
  await shoot(desk, 'desktop-4-flight')
  await desk.evaluate(() => {
    const w = globalThis as unknown as Win
    w.__clock.seek(w.__clock.endTime - 0.001)
    w.__game.getState().setFlightPlaying(true)
  })
  await wait(desk, 3500)
  await shoot(desk, 'desktop-5-result')

  // phone
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  await fresh(phone)
  await shoot(phone, 'phone-1-missions')
  await plan(phone, 'L2', 0, 0.2)
  await shoot(phone, 'phone-2-plan')
  await plan(phone, 'L5', 2, 0.258)
  await phone.evaluate(() => (globalThis as unknown as Win).__game.getState().launch())
  await wait(phone, 400)
  await phone.evaluate(() => {
    const w = globalThis as unknown as Win
    w.__clock.seek(9.15)
    w.__game.getState().setFlightSpeed(1)
  })
  await wait(phone, 2600)
  await shoot(phone, 'phone-3-flight')

  await browser.close()
}

await run()
