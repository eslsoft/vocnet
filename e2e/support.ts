import { readFileSync } from 'node:fs'
import { expect, type Page } from '@playwright/test'

/** Opens the console, which sends a signed-out browser to /login, and signs in through the test OIDC provider. */
export async function signIn(page: Page, { keyboard = false } = {}) {
  await page.goto('/console')
  await expect(page).toHaveURL(/\/login$/)
  const button = page.getByRole('button', { name: 'Sign in' })
  if (keyboard) {
    await button.focus()
    await page.keyboard.press('Enter')
  } else {
    await button.click()
  }
  await expect(page).toHaveURL(/\/console$/)
}

export interface RouteBudget {
  maxDomContentLoadedMs: number
  maxScriptTransferBytes: number
  maxRequests: number
  maxCumulativeLayoutShift: number
}

export function routeBudget(route: string): RouteBudget {
  const budgets = JSON.parse(readFileSync('quality/performance-budgets.json', 'utf8')) as {
    routes: Record<string, RouteBudget & { path: string }>
  }
  const budget = budgets.routes[route]
  if (!budget) throw new Error(`quality/performance-budgets.json has no budget for ${route}.`)
  return budget
}

/** Counts layout shifts from the first paint; call before the first navigation. */
export async function observeLayoutShift(page: Page) {
  await page.addInitScript(() => {
    ;(window as unknown as { __e2eCls: number }).__e2eCls = 0
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as Array<PerformanceEntry & { hadRecentInput: boolean; value: number }>) {
        if (!entry.hadRecentInput) (window as unknown as { __e2eCls: number }).__e2eCls += entry.value
      }
    }).observe({ type: 'layout-shift', buffered: true })
  })
}

export async function expectWithinBudget(page: Page, budget: RouteBudget) {
  await page.waitForLoadState('networkidle')
  const metrics = await page.evaluate(() => {
    const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming
    const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[]
    return {
      domContentLoadedMs: navigation.domContentLoadedEventEnd,
      scriptTransferBytes: resources
        .filter((entry) => entry.initiatorType === 'script' || entry.name.endsWith('.js'))
        .reduce((total, entry) => total + (entry.transferSize || entry.encodedBodySize), 0),
      requests: resources.length + 1,
      cumulativeLayoutShift: (window as unknown as { __e2eCls: number }).__e2eCls,
    }
  })
  expect(metrics.domContentLoadedMs).toBeLessThanOrEqual(budget.maxDomContentLoadedMs)
  expect(metrics.scriptTransferBytes).toBeLessThanOrEqual(budget.maxScriptTransferBytes)
  expect(metrics.requests).toBeLessThanOrEqual(budget.maxRequests)
  expect(metrics.cumulativeLayoutShift).toBeLessThanOrEqual(budget.maxCumulativeLayoutShift)
}
