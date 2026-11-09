import { readFileSync } from 'node:fs'
import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

const budget = (
  JSON.parse(readFileSync('quality/performance-budgets.json', 'utf8')) as {
    routes: {
      notes: {
        maxDomContentLoadedMs: number
        maxScriptTransferBytes: number
        maxRequests: number
        maxCumulativeLayoutShift: number
      }
    }
  }
).routes.notes

async function signIn(page: import('@playwright/test').Page) {
  await page.goto('/')
  const signIn = page.getByRole('button', { name: 'Sign in' })
  await signIn.focus()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/$/)
}

test('critical UI is accessible and dialog focus is correct [spec: auth/login]', async ({ page }) => {
  const loginResponse = await page.goto('/')
  expect(loginResponse?.headers()['content-security-policy']).toContain("script-src 'self'")
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])

  const signIn = page.getByRole('button', { name: 'Sign in' })
  await signIn.focus()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/$/)
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])

  const create = page.getByRole('button', { name: 'Create note' })
  await create.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('textbox')).toBeFocused()
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
  await page.keyboard.press('Escape')
  await expect(create).toBeFocused()
})

test('notes route stays inside its deterministic performance budget', async ({ page }) => {
  await page.addInitScript(() => {
    ;(window as unknown as { __e2eCls: number }).__e2eCls = 0
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as Array<PerformanceEntry & { hadRecentInput: boolean; value: number }>) {
        if (!entry.hadRecentInput) (window as unknown as { __e2eCls: number }).__e2eCls += entry.value
      }
    }).observe({ type: 'layout-shift', buffered: true })
  })
  await signIn(page)
  await page.waitForLoadState('networkidle')

  const metrics = await page.evaluate(() => {
    const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming
    const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[]
    return {
      domContentLoadedMs: navigation.domContentLoadedEventEnd,
      scriptTransferBytes: resources
        .filter((entry) => entry.initiatorType === 'script')
        .reduce((total, entry) => total + (entry.transferSize || entry.encodedBodySize), 0),
      requests: resources.length + 1,
      cumulativeLayoutShift: (window as unknown as { __e2eCls: number }).__e2eCls,
    }
  })

  expect(metrics.domContentLoadedMs).toBeLessThanOrEqual(budget.maxDomContentLoadedMs)
  expect(metrics.scriptTransferBytes).toBeLessThanOrEqual(budget.maxScriptTransferBytes)
  expect(metrics.requests).toBeLessThanOrEqual(budget.maxRequests)
  expect(metrics.cumulativeLayoutShift).toBeLessThanOrEqual(budget.maxCumulativeLayoutShift)
})

test('critical page matches its reviewed visual baseline', async ({ page }) => {
  await signIn(page)
  await page.getByRole('link', { name: 'About' }).click()
  await expect(page.getByRole('heading', { name: 'About' })).toBeVisible()
  await expect(page).toHaveScreenshot('about-page.png', {
    animations: 'disabled',
    maxDiffPixelRatio: 0.02,
  })
})

test('resource text cannot execute markup [spec: notes/create]', async ({ page }) => {
  await signIn(page)
  const payload = '<img src=x onerror="window.__e2eXss=1">'
  await page.getByRole('button', { name: 'Create note' }).click()
  await page.getByRole('textbox').fill(payload)
  await page.getByRole('button', { name: 'Add' }).click()

  await expect(page.getByText(payload)).toBeVisible()
  expect(await page.evaluate(() => (window as unknown as { __e2eXss?: number }).__e2eXss)).toBeUndefined()
})
