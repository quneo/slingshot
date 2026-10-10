import { expect, test } from './fixtures'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.clear())
})

test('first mission with the guided tutorial: impulse, forecast, launch, win', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Играть' })).toBeVisible()
  await page.getByRole('button', { name: 'Играть' }).click()

  // the tour starts by itself and points at the ship, then the target
  await expect(page.getByRole('dialog', { name: 'Это ваш корабль' })).toBeVisible()
  await page.getByRole('button', { name: 'Далее' }).click()
  await expect(page.getByRole('dialog', { name: 'Цель — Рубра' })).toBeVisible()
  await page.getByRole('button', { name: 'Далее' }).click()

  // "pull the green arrow": any change of the launch impulse completes the step (here via the editor)
  await expect(page.getByRole('dialog', { name: 'Потяните зелёную стрелку' })).toBeVisible()
  const field = page.getByRole('textbox', { name: 'Импульс' })
  // phones open the editor on tap (during this tour it is already open)
  if (!(await field.isVisible())) await page.getByRole('button', { name: /Старт/ }).first().click()
  await field.fill('3,69')
  await field.press('Enter')

  // the forecast step completes once the path reaches the ring
  await expect(page.getByText('Рубра: цель достигнута').first()).toBeVisible()
  for (const title of ['Бюджет Δv', 'Точная настройка', 'Шкала времени']) {
    await expect(page.getByRole('dialog', { name: title })).toBeVisible()
    await page.getByRole('button', { name: 'Далее' }).click()
  }
  await expect(page.getByRole('dialog', { name: 'Пуск!' })).toBeVisible()
  await page.getByRole('button', { name: 'Пуск', exact: true }).click()

  // flight tour, then the flight itself
  await expect(page.getByRole('dialog', { name: 'Скорость времени' })).toBeVisible()
  await page.getByRole('button', { name: 'Далее' }).click()
  await page.getByRole('button', { name: 'Понятно' }).click()
  await page.getByRole('radio', { name: '×100' }).click()
  await expect(page.getByRole('heading', { name: 'Миссия выполнена!' })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('img', { name: /Звёзд: [1-3] из 3/ }).first()).toBeVisible()

  // progress is saved and the next mission opens
  await page.getByRole('button', { name: 'Далее' }).click()
  await expect(page.getByText(/Планеты движутся/).first()).toBeVisible()
})

test('a collision with a planet is reported with its cause', async ({ page }, info) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      'slingshot:save',
      JSON.stringify({ version: 1, settings: { unlockAll: true }, progress: {}, tutorialDone: ['L3:plan'] }),
    ),
  )
  await page.goto('/')
  await page.getByRole('button', { name: /Первая праща/ }).click()
  await page.getByRole('button', { name: 'Играть' }).click()
  if (info.project.name === 'phone') await page.getByRole('button', { name: /Старт/ }).first().click()
  // launch on day 175 with 6.1 km/s: the ship flies straight into Colossus
  const date = page.getByRole('slider', { name: 'Дата старта' })
  await date.focus()
  await date.press('Home')
  for (let i = 0; i < 17; i++) await date.press('PageUp')
  for (let i = 0; i < 5; i++) await date.press('ArrowRight')
  await expect(page.getByText('175-й день').first()).toBeVisible()
  const field = page.getByRole('textbox', { name: 'Импульс' })
  await field.fill('6,1')
  await field.press('Enter')
  await expect(page.getByText(/Столкновение: Колосс/).first()).toBeVisible({ timeout: 10_000 })
})
