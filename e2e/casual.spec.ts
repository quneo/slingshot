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
  __renderer: { shipX: number; shipY: number; camera: { animating: boolean } }
  __session: () => {
    phase: string
    level: { power: number; fuel: number; reference: { dvx: number; dvy: number } }
    flight: { fuelLeft: number } | null
  }
}

/** Waits until the aiming camera has settled on the level. */
async function settled(page: Page) {
  await page.waitForFunction(() => {
    const g = globalThis as Debug
    return !!g.__renderer && !g.__renderer.camera.animating && g.__session().phase === 'aim'
  })
}

/** Pulls the slingshot with a real pointer: `k` scales the reference throw, `turn` rotates it (radians). */
async function throwShip(page: Page, k = 1, turn = 0) {
  const { x, y, px, py } = await page.evaluate(
    ([k, turn]) => {
      const g = globalThis as Debug
      const s = g.__session()
      const max = Math.min(210, Math.max(110, Math.min(g.innerWidth, g.innerHeight) * 0.3))
      const { dvx, dvy } = s.level.reference
      const c = Math.cos(turn)
      const sn = Math.sin(turn)
      const rx = (dvx * c - dvy * sn) * k
      const ry = (dvx * sn + dvy * c) * k
      return { x: g.__renderer.shipX, y: g.__renderer.shipY, px: (-rx / s.level.power) * max, py: (ry / s.level.power) * max }
    },
    [k, turn] as const,
  )
  await page.mouse.move(x, y)
  await page.mouse.down()
  for (let i = 1; i <= 12; i++) await page.mouse.move(x + (px * i) / 12, y + (py * i) / 12)
  await page.waitForTimeout(150)
  await page.mouse.up()
}

test('first mission: pull, release, collect the stardust, arrive, go on', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('button', { name: /Миссия 1: Первый бросок/ })).toBeEnabled()
  await expect(page.getByRole('button', { name: /Миссия 2: .*закрыта/ })).toBeDisabled()
  await page.getByRole('button', { name: /Миссия 1: Первый бросок/ }).click()

  await expect(page.getByTestId('goal')).toHaveText('Долети до Рубры')
  await expect(page.getByTestId('aim-hint')).toContainText('Оттяни корабль назад')
  await settled(page)
  await throwShip(page)

  await expect(page.getByTestId('speed')).toBeVisible()
  const result = page.getByRole('dialog', { name: 'Миссия выполнена' })
  await expect(result).toBeVisible({ timeout: 30_000 })
  await expect(result.getByRole('img', { name: 'Звёзд: 3 из 3' })).toBeVisible()
  await expect(result.getByText('Звёздная пыль ×3')).toBeVisible()

  await result.getByRole('button', { name: /Дальше/ }).click()
  await expect(page.getByTestId('goal')).toHaveText('Поймай Рубру на бегу')

  // progress survives a reload
  await page.reload()
  await expect(page.getByTestId('total-stars')).toHaveText('3 / 36')
  await expect(page.getByRole('button', { name: /Миссия 2: Упреждение/ })).toBeEnabled()
})

test('a bad throw fails, says why, and the next aim starts by itself', async ({ page }) => {
  await page.goto('/?all')
  await page.getByRole('button', { name: /Миссия 5: Первая праща/ }).click()
  await settled(page)
  // aimed the other way: the ship falls short or into a planet
  await throwShip(page, 1, Math.PI * 0.75)
  await expect(page.getByRole('status')).toContainText(/Врезался|Сгорел|Улетел|Не долетел/, { timeout: 30_000 })
  await expect(page.getByTestId('aim-hint')).toBeVisible({ timeout: 10_000 })
})

test('holding a finger in flight charges a boost that spends fuel', async ({ page }) => {
  await page.goto('/?all')
  await page.getByRole('button', { name: /Миссия 5: Первая праща/ }).click()
  await settled(page)
  await throwShip(page)
  await expect(page.getByTestId('fuel')).toBeVisible()
  const box = (await page.locator('canvas').boundingBox())!
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.25)
  await page.mouse.down()
  await page.waitForTimeout(400)
  await page.mouse.up()
  const { left, full } = await page.evaluate(() => {
    const s = (globalThis as Debug).__session()
    return { left: s.flight?.fuelLeft ?? -1, full: s.level.fuel }
  })
  expect(left).toBeGreaterThanOrEqual(0)
  expect(left).toBeLessThan(full - 1e-6)
})

test('the keyboard can aim and throw', async ({ page }, info) => {
  test.skip(info.project.name === 'phone', 'keyboard play is a desktop feature')
  await page.goto('/')
  await page.getByRole('button', { name: /Миссия 1: Первый бросок/ }).click()
  await settled(page)
  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowUp')
  await page.keyboard.press('Space')
  await expect(page.getByTestId('speed')).toBeVisible()
  const phase = await page.evaluate(() => (globalThis as Debug).__session().phase)
  expect(phase).not.toBe('aim')
})

test('sound can be switched off and stays off', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Выключить звук' }).click()
  await page.reload()
  await expect(page.getByRole('button', { name: 'Включить звук' })).toBeVisible()
})
