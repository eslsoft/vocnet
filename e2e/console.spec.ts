import { expect, test } from '@playwright/test'

test('an admin signs in and reaches the console home [spec: access/console-login]', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('heading', { name: 'Vocnet console' })).toBeVisible()
})
