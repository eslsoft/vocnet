import { describe, expect, it, vi } from 'vitest'
import { installBrowserErrorBoundary, reportBrowserError } from './errors'

describe('browser error boundary', () => {
  it('reports direct, window, and promise errors through one sink', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    installBrowserErrorBoundary()

    reportBrowserError(new Error('direct'), 'test')
    window.dispatchEvent(new ErrorEvent('error', { error: new Error('window') }))
    const rejection = new Event('unhandledrejection')
    Object.defineProperty(rejection, 'reason', { value: new Error('promise') })
    window.dispatchEvent(rejection)

    expect(spy).toHaveBeenCalledTimes(3)
    spy.mockRestore()
  })
})
