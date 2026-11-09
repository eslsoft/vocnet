import { readFileSync } from 'node:fs'
import { defineConfig, devices } from '@playwright/test'

const baseURL = process.env.E2E_BASE_URL
const outputDir = process.env.E2E_ARTIFACT_DIR
if (!baseURL || !outputDir) throw new Error('Run E2E through `pnpm e2e`.')
const support = JSON.parse(readFileSync('quality/browser-support.json', 'utf8')) as {
  browsers: Array<'chromium' | 'firefox' | 'webkit'>
}
const supportedDevices = {
  chromium: devices['Desktop Chrome'],
  firefox: devices['Desktop Firefox'],
  webkit: devices['Desktop Safari'],
}

// e2e/run.mjs starts dynamic app/OIDC ports and an isolated, migrated D1. The
// suite is stateful, so it runs serially and never retries a failed journey.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  outputDir,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: support.browsers.map((browser) => ({ name: browser, use: { ...supportedDevices[browser] } })),
  snapshotPathTemplate: '{testDir}/__screenshots__/{arg}-{projectName}{ext}',
})
