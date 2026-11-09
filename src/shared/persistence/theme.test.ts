import { afterEach, describe, expect, it } from 'vitest'
import { readTheme, writeTheme } from './theme'

describe('theme persistence', () => {
  afterEach(() => localStorage.clear())

  it('uses the declared product default only when no value exists', () => {
    expect(readTheme()).toBe('system')
  })

  it('round-trips the versioned value', () => {
    writeTheme('dark')
    expect(readTheme()).toBe('dark')
  })

  it('rejects corrupt or unsupported persisted data', () => {
    localStorage.setItem('vocnet:theme', '{')
    expect(() => readTheme()).toThrow('not valid JSON')

    localStorage.setItem('vocnet:theme', JSON.stringify({ version: 2, theme: 'dark' }))
    expect(() => readTheme()).toThrow()
  })
})
