import { expect, test } from '@playwright/test'

test('a developer tries an endpoint from the guide [spec: site/try-it]', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Developers', exact: true }).first().click()
  await expect(page.getByRole('heading', { level: 1, name: 'Developer guide' })).toBeVisible()

  const members = page.getByRole('article', { name: 'Category members' })
  const id = members.getByRole('textbox', { name: /^id/ })
  await expect(id).toHaveValue(/^[0-9a-f-]{36}$/)
  await members.getByRole('button', { name: 'Send request' }).click()
  const body = members.getByRole('region', { name: 'Body' })
  await expect(body.getByText('200 OK')).toBeVisible()
  await expect(body.getByText('Matches the contract')).toBeVisible()
  await expect(body.getByText('public, max-age=5')).toBeVisible()
  await expect(body).toContainText('"depth": 1')

  const entry = page.getByRole('article', { name: 'Get an entry' })
  await entry.getByRole('textbox', { name: /^lemma/ }).fill('animalz')
  await entry.getByRole('button', { name: 'Send request' }).click()
  await expect(entry.getByText('404 Not Found')).toBeVisible()
  await expect(entry).toContainText('"code": "not_found"')
})
