import { afterEach, describe, expect, it } from 'vitest'
import { readLanguage, writeLanguage } from './language'

describe('language persistence', () => {
  afterEach(() => localStorage.clear())

  it('follows the browser preference until a choice is stored', () => {
    expect(readLanguage(['zh-TW', 'en'])).toBe('zh-CN')
    expect(readLanguage(['en-GB'])).toBe('en-US')
    expect(readLanguage([])).toBe('en-US')
  })

  it('round-trips the versioned value', () => {
    writeLanguage('zh-CN')
    expect(readLanguage(['en-US'])).toBe('zh-CN')
  })

  it('rejects corrupt or unsupported persisted data', () => {
    localStorage.setItem('vocnet:language', '{')
    expect(() => readLanguage([])).toThrow('not valid JSON')

    localStorage.setItem('vocnet:language', JSON.stringify({ version: 1, language: 'fr-FR' }))
    expect(() => readLanguage([])).toThrow()
  })
})
