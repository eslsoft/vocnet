import { SERVED_LANGUAGES } from '@shared/facts'
import { describe, expect, it } from 'vitest'
import { negotiateLanguage, readsLanguage, servedLanguage } from './language'

describe('served language', () => {
  it('reads stored zh, which is Simplified, only for Simplified Chinese requests [spec: catalog/script-safety]', () => {
    expect(SERVED_LANGUAGES).toEqual(['zh'])
    for (const tag of ['zh', 'ZH', 'zh-Hans', 'zh-hans-CN', 'zh-Hans-TW', 'zh-CN', 'zh-sg']) {
      expect(servedLanguage(tag)).toBe('zh')
    }
    for (const tag of [
      'zh-Hant',
      'zh-Hant-TW',
      'zh-hant-hk',
      'zh-TW',
      'zh-HK',
      'zh-MO',
      'zh-yue',
      'zh-US',
      'en',
      'ja',
    ]) {
      expect(servedLanguage(tag)).toBeNull()
    }
  })

  it('reads another stored language when the request equals it or only adds a region', () => {
    expect(readsLanguage('pt', 'pt')).toBe(true)
    expect(readsLanguage('PT-br', 'pt')).toBe(true)
    expect(readsLanguage('es-419', 'es')).toBe(true)
    expect(readsLanguage('sr-Latn', 'sr')).toBe(false)
    expect(readsLanguage('sr-Latn-RS', 'sr')).toBe(false)
    expect(readsLanguage('pt', 'pt-BR')).toBe(false)
    expect(readsLanguage('ptx', 'pt')).toBe(false)
    expect(readsLanguage('zh-Hant', 'zh-Hant')).toBe(true)
    expect(readsLanguage('zh-TW', 'zh-Hant')).toBe(false)
  })

  it('negotiates the first preferred tag that reads a served language', () => {
    expect(negotiateLanguage(['en-US', 'en', 'zh-CN'])).toBe('zh')
    expect(negotiateLanguage(['zh-TW', 'zh'])).toBe('zh')
    expect(negotiateLanguage(['zh-TW', 'en'])).toBeNull()
    expect(negotiateLanguage([])).toBeNull()
  })
})
