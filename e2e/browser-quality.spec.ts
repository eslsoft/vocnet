import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { expectWithinBudget, observeLayoutShift, routeBudget, signIn } from './support'

const axe = async (page: import('@playwright/test').Page) => (await new AxeBuilder({ page }).analyze()).violations

test('the public site and the console are accessible and keyboard operable [spec: access/console-login]', async ({
  page,
}) => {
  const home = await page.goto('/')
  expect(home?.headers()['content-security-policy']).toContain("script-src 'self';")
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  expect(await axe(page)).toEqual([])

  await page.keyboard.press('Tab')
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused()
  await page.getByRole('combobox', { name: 'Search the dictionary' }).fill('an')
  await expect(page.getByRole('option').first()).toBeVisible()
  expect(await axe(page)).toEqual([])

  await page.goto('/browse?root=animal')
  await page.getByRole('button', { name: 'Kinds of bird' }).click()
  await expect(page.getByRole('link', { name: /^eagle/ })).toBeVisible()
  expect(await axe(page)).toEqual([])

  await page.goto('/words/animal')
  await expect(page.getByRole('heading', { level: 1, name: 'animal' })).toBeVisible()
  await page.getByRole('button', { name: 'API' }).nth(2).click()
  await expect(page.getByRole('region', { name: 'Where this block comes from' })).toBeVisible()
  expect(await axe(page)).toEqual([])

  await signIn(page, { keyboard: true })
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible()
  expect(await axe(page)).toEqual([])
})

for (const route of ['home', 'entry', 'browse'] as const) {
  test(`the ${route} route stays inside its deterministic performance budget`, async ({ page }) => {
    const budget = routeBudget(route)
    await observeLayoutShift(page)
    await page.goto(budget.path)
    await expectWithinBudget(page, budget)
  })
}

test('the console route stays inside its deterministic performance budget', async ({ page }) => {
  await observeLayoutShift(page)
  await signIn(page)
  await expectWithinBudget(page, routeBudget('console'))
})

test('critical pages match their reviewed visual baselines', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(page.getByText('wordfreq', { exact: true })).toBeVisible()
  // The curl examples name the origin, whose port each run picks.
  await expect(page).toHaveScreenshot('home-page.png', {
    animations: 'disabled',
    fullPage: true,
    mask: [page.locator('pre')],
    maxDiffPixelRatio: 0.02,
  })

  await page.goto('/words/animal')
  await expect(page.getByRole('heading', { level: 1, name: 'animal' })).toBeVisible()
  await expect(page.getByText('Very common').or(page.getByText('Common')).first()).toBeVisible()
  await expect(page).toHaveScreenshot('entry-page.png', { animations: 'disabled', maxDiffPixelRatio: 0.02 })

  await signIn(page)
  await page.getByRole('link', { name: 'About' }).click()
  await expect(page.getByRole('heading', { name: 'About' })).toBeVisible()
  await expect(page).toHaveScreenshot('about-page.png', { animations: 'disabled', maxDiffPixelRatio: 0.02 })
})
