import { expect, test } from '@playwright/test'

test('sign in and create a note [spec: auth/login] [spec: notes/create]', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/$/)

  await page.getByRole('button', { name: 'Create note' }).click()
  await page.getByRole('textbox').fill('an end-to-end note')
  await page.getByRole('button', { name: 'Add' }).click()

  await expect(page.getByText('an end-to-end note')).toBeVisible()
})
