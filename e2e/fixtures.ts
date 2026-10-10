import { test as base, expect } from '@playwright/test'

/** Every e2e test also fails on uncaught page errors (e.g. an exception inside the render loop). */
export const test = base.extend<{ pageErrors: string[] }>({
  pageErrors: [
    async ({ page }, use) => {
      const errors: string[] = []
      page.on('pageerror', (e) => errors.push(e.message))
      await use(errors)
      expect(errors, 'uncaught errors on the page').toEqual([])
    },
    { auto: true },
  ],
})

export { expect }
