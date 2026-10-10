import { expect, test } from './fixtures'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.clear())
})

test('first mission: set the launch impulse, fly, win', async ({ page }, info) => {
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Играть' })).toBeVisible()
  await page.getByRole('button', { name: 'Играть' }).click()

  // starting plan misses the target
  await expect(page.getByText(/Не долетаете до орбиты|Промах|разминулись/).first()).toBeVisible()

  // precise input: open the launch editor on phones, type 3.69 km/s straight ahead
  if (info.project.name === 'phone') await page.getByRole('button', { name: /Старт/ }).first().click()
  const field = page.getByRole('textbox', { name: 'Импульс' })
  await field.fill('3,69')
  await field.press('Enter')
  await expect(page.getByText('Рубра: цель достигнута').first()).toBeVisible({ timeout: 10_000 })

  await page.getByRole('button', { name: 'Пуск' }).click()
  await expect(page.getByText('Перелёт к Рубре').first()).toBeVisible()
  await page.getByRole('radio', { name: '×100' }).click()
  await expect(page.getByRole('heading', { name: 'Миссия выполнена!' })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('img', { name: /Звёзд: [1-3] из 3/ }).first()).toBeVisible()

  // progress is saved and the next mission opens
  await page.getByRole('button', { name: 'Далее' }).click()
  await expect(page.getByRole('heading', { name: 'Планеты движутся' }).or(page.getByText('2. Планеты движутся'))).toBeVisible()
})

test('a collision with a planet is reported with its cause', async ({ page }, info) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      'slingshot:save',
      JSON.stringify({ version: 1, settings: { unlockAll: true }, progress: {}, tutorialDone: ['L3'] }),
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
