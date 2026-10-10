import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'

/**
 * Plays the whole campaign through the UI only (no debug handles): every mission is solvable with the
 * controls a player has — launch date slider, numeric impulse and angle, corrections.
 */

async function setSlider(page: Page, name: string, steps: number) {
  const slider = page.getByRole('slider', { name })
  await slider.focus()
  await slider.press('Home')
  for (let i = 0; i < Math.floor(steps / 10); i++) await slider.press('PageUp')
  for (let i = 0; i < steps % 10; i++) await slider.press('ArrowRight')
}

async function setNumber(page: Page, name: string, value: string) {
  const field = page.getByRole('textbox', { name })
  await field.fill(value)
  await field.press('Enter')
}

async function flyAndWin(page: Page) {
  await page.getByRole('button', { name: 'Пуск' }).click()
  await page.getByRole('radio', { name: '×100' }).click()
  await expect(page.getByRole('heading', { name: 'Миссия выполнена!' })).toBeVisible({ timeout: 40_000 })
}

test('the whole campaign can be won through the interface', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'one full run is enough')
  test.setTimeout(180_000)
  await page.addInitScript(() => {
    // fresh player, tutorials already seen
    if (!sessionStorage.getItem('seeded')) {
      localStorage.setItem(
        'slingshot:save',
        JSON.stringify({ version: 1, settings: {}, progress: {}, tutorialDone: ['L1:plan', 'L1:flight', 'L2:plan', 'L3:plan', 'L4:plan', 'L5:plan', 'L6:plan'] }),
      )
      sessionStorage.setItem('seeded', '1')
    }
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'Играть' }).click()

  // 1. one launch impulse
  await setNumber(page, 'Импульс', '3,69')
  await expect(page.getByText('Рубра: цель достигнута').first()).toBeVisible()
  await flyAndWin(page)
  await page.getByRole('button', { name: 'Далее' }).click()

  // 2. launch window
  await setSlider(page, 'Дата старта', 362)
  await setNumber(page, 'Импульс', '6,31')
  await expect(page.getByText('Колосс: цель достигнута').first()).toBeVisible()
  await flyAndWin(page)
  await page.getByRole('button', { name: 'Далее' }).click()

  // 3. first slingshot
  await setSlider(page, 'Дата старта', 175)
  await setNumber(page, 'Импульс', '6,9')
  await expect(page.getByText('Аурум: цель достигнута').first()).toBeVisible()
  await flyAndWin(page)
  await page.getByRole('button', { name: 'Далее' }).click()

  // 4. braking flyby: a correction backwards on day ~88
  await page.getByRole('button', { name: 'Добавить коррекцию' }).click()
  await setSlider(page, 'Время импульса', 87)
  await setNumber(page, 'Угол к курсу', '180')
  await setNumber(page, 'Импульс', '0,89')
  await expect(page.getByText('Аква: цель достигнута').first()).toBeVisible()
  await flyAndWin(page)
  await page.getByRole('button', { name: 'Далее' }).click()

  // 5. two slingshots
  await setSlider(page, 'Дата старта', 117)
  await setNumber(page, 'Импульс', '7,67')
  await expect(page.getByText('Виола: цель достигнута').first()).toBeVisible()
  await flyAndWin(page)
  await page.getByRole('button', { name: 'Далее' }).click()

  // 6. rendezvous: one burn is a fly-past, the second one matches Rubra's speed
  await setSlider(page, 'Дата старта', 117)
  await setNumber(page, 'Импульс', '3,05')
  await expect(page.getByText('Скорости не совпали').first()).toBeVisible()
  await page.getByRole('button', { name: 'Добавить коррекцию' }).click()
  await setSlider(page, 'Время импульса', 255)
  await setNumber(page, 'Импульс', '2,47')
  await expect(page.getByText('Рубра: цель достигнута').first()).toBeVisible()
  await flyAndWin(page)

  // campaign complete, progress saved
  await page.getByRole('button', { name: 'К миссиям' }).click()
  await expect(page.getByText('Кампания пройдена')).toBeVisible()
})
