import { expect, test } from '@playwright/test'

async function signIn(page: import('@playwright/test').Page) {
  await page.goto('/')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/$/)
}

test('an admin signs in and reaches the console overview [spec: access/console-login]', async ({ page }) => {
  await signIn(page)
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible()
  await expect(page.getByText('Open feedback')).toBeVisible()
})

test('an admin issues an agent key that authenticates the agent [spec: console/agent-issue]', async ({
  page,
  request,
}) => {
  await signIn(page)
  await page.getByRole('link', { name: 'Agents' }).click()
  await page.getByRole('button', { name: 'Issue key' }).click()
  await page.getByRole('dialog').getByLabel('Name').fill('E2E producer')
  await page.getByRole('dialog').getByRole('button', { name: 'Issue' }).click()

  const key = (await page.getByTestId('agent-secret').textContent()) ?? ''
  expect(key).toMatch(/^vn_agent_/)
  const asAgent = await request.get('/manage/v1/stats', { headers: { authorization: `Bearer ${key}` } })
  expect(asAgent.status()).toBe(200)

  await page.keyboard.press('Escape')
  await expect(page.getByTestId('agent-secret')).toHaveCount(0)
  await expect(page.getByRole('row', { name: /E2E producer/ }).getByText('Active')).toBeVisible()
})
