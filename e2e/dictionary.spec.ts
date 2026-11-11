import { expect, test } from '@playwright/test'

test('a relation link opens the related sense on its entry page [spec: site/relation-link]', async ({ page }) => {
  await page.goto('/words/animal')
  await expect(page.getByRole('heading', { level: 1, name: 'animal' })).toBeVisible()
  const noun = page.getByRole('region', { name: 'noun' })
  await expect(noun.getByText('动物', { exact: true }).first()).toBeVisible()

  await noun.getByRole('link', { name: 'bird', exact: true }).first().click()
  await expect(page).toHaveURL(/\/words\/bird#sense-[0-9a-f-]+$/)
  await expect(page.getByRole('heading', { level: 1, name: 'bird' })).toBeVisible()
  const target = page.locator(`[id="${new URL(page.url()).hash.slice(1)}"]`)
  await expect(target).toContainText('feathers')
  await expect(target).toHaveClass(/ring-1/)
  await expect(target).toBeInViewport()

  await page.getByRole('link', { name: 'Biology' }).first().click()
  await expect(page).toHaveURL(/domain=biology/)
})

test('an unknown word is not in Vocnet yet [spec: site/entry-missing]', async ({ page }) => {
  const response = await page.goto('/words/animalz')
  expect(response?.status()).toBe(200)
  await expect(page.getByRole('heading', { name: 'Not in Vocnet yet' })).toBeVisible()
})

test('a search from the home page opens the entry [spec: site/home-search]', async ({ page }) => {
  await page.goto('/')
  await page.keyboard.press('/')
  const search = page.getByRole('combobox', { name: 'Search the dictionary' })
  await expect(search).toBeFocused()
  await search.fill('bir')
  await expect(page.getByRole('option', { name: /^bird/ })).toBeVisible()
  await page.keyboard.press('ArrowDown')
  await expect(page.getByRole('option', { name: /^bird/ })).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/words\/bird$/)
  await expect(page.getByRole('heading', { level: 1, name: 'bird' })).toBeVisible()
})

test('browsing a category expands its kinds level by level [spec: site/browse-expand]', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Browse', exact: true }).first().click()
  await page.getByRole('button', { name: 'animal' }).click()
  await expect(page).toHaveURL(/\/browse\?root=animal$/)
  await expect(page.getByRole('heading', { name: 'animal' })).toBeVisible()

  await page.getByRole('button', { name: 'Kinds of bird' }).click()
  await expect(page.getByRole('button', { name: 'Kinds of bird' })).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByRole('link', { name: /^eagle/ })).toBeVisible()
  await page.getByRole('link', { name: /^eagle/ }).click()
  await expect(page).toHaveURL(/\/words\/eagle#sense-/)
  await expect(page.getByRole('heading', { level: 1, name: 'eagle' })).toBeVisible()
})
