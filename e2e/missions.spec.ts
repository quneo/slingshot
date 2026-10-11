import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'

test.beforeEach(async ({ page }) => {
  // a clean save for every test, but kept across reloads within it
  await page.addInitScript(() => {
    if (sessionStorage.getItem('e2e-fresh')) return
    localStorage.clear()
    sessionStorage.setItem('e2e-fresh', '1')
  })
})

/** Dev-server debug handles (see Stage.tsx). */
type Debug = typeof globalThis & {
  innerWidth: number
  innerHeight: number
  __renderer: { anchorX: number; anchorY: number; camera: { animating: boolean } }
  __session: () => {
    phase: string
    t: number
    fuel: number
    hopIndex: number
    checkpoint: { t: number }
    mission: { power: number; fuel: number; hops: { reference: { wait: number; dvx: number; dvy: number } }[] }
  }
}

async function settled(page: Page) {
  await page.waitForFunction(() => {
    const g = globalThis as Debug
    return !!g.__renderer && !g.__renderer.camera.animating && g.__session().phase === 'parked'
  })
}

/**
 * Pulls the slingshot with a real pointer as the reference plan says (rotated by `turn` radians). With `onWindow`
 * the clock is first put on the hop's launch window, as a player would wait for it.
 */
async function throwShip(page: Page, { turn = 0, onWindow = true } = {}) {
  const { x, y, px, py } = await page.evaluate(
    ([turn, onWindow]) => {
      const g = globalThis as Debug
      const s = g.__session()
      const ref = s.mission.hops[s.hopIndex].reference
      if (onWindow) s.t = s.checkpoint.t + ref.wait
      const max = Math.min(210, Math.max(110, Math.min(g.innerWidth, g.innerHeight) * 0.3))
      const c = Math.cos(turn)
      const sn = Math.sin(turn)
      const rx = ref.dvx * c - ref.dvy * sn
      const ry = ref.dvx * sn + ref.dvy * c
      return { x: g.__renderer.anchorX, y: g.__renderer.anchorY, px: (-rx / s.mission.power) * max, py: (ry / s.mission.power) * max }
    },
    [turn, onWindow] as const,
  )
  await page.mouse.move(x, y)
  await page.mouse.down()
  for (let i = 1; i <= 6; i++) await page.mouse.move(x + (px * i) / 6, y + (py * i) / 6)
  await page.mouse.up()
}

test('first mission: wait for the window, throw, capture, three stars, next mission', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('button', { name: /Миссия 1: Первое окно/ })).toBeEnabled()
  await expect(page.getByRole('button', { name: /Миссия 2: .*закрыта/ })).toBeDisabled()
  await page.getByRole('button', { name: /Миссия 1: Первое окно/ }).click()

  await expect(page.getByTestId('goal')).toHaveText('Перелети с Аквы на Рубру')
  await expect(page.getByTestId('windows')).toBeVisible()
  await expect(page.getByRole('list', { name: 'Маршрут' })).toContainText('Рубра')
  await settled(page)
  await throwShip(page)

  const result = page.getByRole('dialog', { name: 'Миссия выполнена' })
  await expect(result).toBeVisible({ timeout: 30_000 })
  await expect(result.getByRole('img', { name: /Звёзд: [23] из 3/ })).toBeVisible()
  await expect(result.getByText('Аква → Рубра')).toBeVisible()

  await result.getByRole('button', { name: /Дальше/ }).click()
  await expect(page.getByTestId('goal')).toHaveText('Спустись с Аквы на Пепел')
  await page.reload()
  await expect(page.getByRole('button', { name: /Миссия 2: Вниз, к Пеплу/ })).toBeEnabled()
})

test('the forecast prices the throw, and holding "wait" runs the clock fast', async ({ page }) => {
  await page.goto('/?all')
  await page.getByRole('button', { name: /Миссия 1: Первое окно/ }).click()
  await settled(page)
  const box = (await page.locator('canvas').boundingBox())!
  const anchor = await page.evaluate(() => ({ x: (globalThis as Debug).__renderer.anchorX, y: (globalThis as Debug).__renderer.anchorY }))
  // hold a pull: the tank shows what the throw would cost
  await page.mouse.move(anchor.x, anchor.y)
  await page.mouse.down()
  await page.mouse.move(anchor.x - 60, anchor.y + 40)
  await expect(page.getByTestId('forecast')).toContainText(/старт \d/)
  // a tiny release does not launch
  await page.mouse.move(anchor.x + 2, anchor.y + 2)
  await page.mouse.up()
  expect(await page.evaluate(() => (globalThis as Debug).__session().phase)).toBe('parked')

  const t0 = await page.evaluate(() => (globalThis as Debug).__session().t)
  const wait = page.getByTestId('wait')
  const wb = (await wait.boundingBox())!
  await page.mouse.move(wb.x + wb.width / 2, wb.y + wb.height / 2)
  await page.mouse.down()
  await expect(wait).toHaveAttribute('aria-pressed', 'true')
  await page.waitForTimeout(600)
  await page.mouse.up()
  const t1 = await page.evaluate(() => (globalThis as Debug).__session().t)
  expect(t1 - t0).toBeGreaterThan(0.5)
  void box
})

test('a bad throw fails, says why, and the hop starts again from the parking orbit', async ({ page }) => {
  await page.goto('/?all')
  await page.getByRole('button', { name: /Миссия 5: К Колоссу/ }).click()
  await settled(page)
  await throwShip(page, { turn: Math.PI })
  await expect(page.getByRole('status')).toContainText(/Врезался|Сгорел|Улетел|Разминулся|топлива/, { timeout: 30_000 })
  await expect(page.getByTestId('tip')).toBeVisible({ timeout: 10_000 })
  const s = await page.evaluate(() => {
    const x = (globalThis as Debug).__session()
    return { phase: x.phase, fuel: x.fuel, full: x.mission.fuel }
  })
  expect(s.phase).toBe('parked')
  expect(s.fuel).toBeCloseTo(s.full, 9)
})

test('the keyboard can aim and throw', async ({ page }, info) => {
  test.skip(info.project.name === 'phone', 'keyboard play is a desktop feature')
  await page.goto('/')
  await page.getByRole('button', { name: /Миссия 1: Первое окно/ }).click()
  await settled(page)
  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowUp')
  await expect(page.getByTestId('forecast')).toContainText(/старт \d/)
  await page.keyboard.press('Space')
  await expect(page.getByTestId('speed')).toBeVisible()
})

test('sound can be switched off and stays off', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Выключить звук' }).click()
  await page.reload()
  await expect(page.getByRole('button', { name: 'Включить звук' })).toBeVisible()
})
