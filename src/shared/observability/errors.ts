export function reportBrowserError(error: unknown, context: string): void {
  console.error(`[${context}]`, error)
}

export function installBrowserErrorBoundary(): void {
  window.addEventListener('error', (event) => reportBrowserError(event.error, 'window.error'))
  window.addEventListener('unhandledrejection', (event) =>
    reportBrowserError(event.reason, 'window.unhandledrejection'),
  )
}
