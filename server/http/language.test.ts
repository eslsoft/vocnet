import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import { preferredLanguage, readVariant } from './language'

describe('read language', () => {
  it('takes lang over Accept-Language, else the preferred tag by quality [spec: catalog/accept-language]', async () => {
    expect(preferredLanguage('zh-CN,zh;q=0.9,en;q=0.8')).toBe('zh-CN')
    expect(preferredLanguage('en;q=0.5, zh;q=0.9, fr')).toBe('fr')
    expect(preferredLanguage('en;q=0.8, zh;q=0.8')).toBe('en')
    expect(preferredLanguage('*, zh;q=0.1')).toBe('zh')
    expect(preferredLanguage('zh;q=0, en-GB;Q=0.4')).toBe('en-GB')
    expect(preferredLanguage('*;q=1, 12-x')).toBeNull()
    expect(preferredLanguage('')).toBeNull()
    expect(preferredLanguage(undefined)).toBeNull()

    const app = new Hono().get('/', (c) => {
      const lang = c.req.query('lang')
      return c.json(readVariant(c, { lang, include: c.req.query('include') === 'review' ? 'review' : undefined }))
    })
    const read = async (query: string, acceptLanguage?: string) => {
      const response = await app.request(`/${query}`, {
        headers: acceptLanguage ? { 'accept-language': acceptLanguage } : {},
      })
      expect(response.headers.get('vary')).toBe('Accept-Language')
      return response.json()
    }
    expect(await read('?lang=fr', 'zh')).toEqual({ lang: 'fr', review: false })
    expect(await read('', 'zh-CN,zh;q=0.9')).toEqual({ lang: 'zh-CN', review: false })
    expect(await read('?lang=all&include=review')).toEqual({ lang: 'all', review: true })
    expect(await read('')).toEqual({ lang: null, review: false })
  })
})
