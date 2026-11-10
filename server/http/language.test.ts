import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import { acceptedLanguages, readVariant } from './language'

describe('read language', () => {
  it('takes lang over Accept-Language, else the most preferred tag that reads a served language [spec: catalog/accept-language]', async () => {
    expect(acceptedLanguages('zh-CN,zh;q=0.9,en;q=0.8')).toEqual(['zh-CN', 'zh', 'en'])
    expect(acceptedLanguages('en;q=0.5, zh;q=0.9, fr')).toEqual(['fr', 'zh', 'en'])
    expect(acceptedLanguages('en;q=0.8, zh;q=0.8')).toEqual(['en', 'zh'])
    expect(acceptedLanguages('*, zh;q=0.1')).toEqual(['zh'])
    expect(acceptedLanguages('zh;q=0, en-GB;Q=0.4')).toEqual(['en-GB'])
    expect(acceptedLanguages('*;q=1, 12-x')).toEqual([])
    expect(acceptedLanguages('')).toEqual([])
    expect(acceptedLanguages(undefined)).toEqual([])

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
    expect(await read('?lang=fr', 'zh')).toEqual({ lang: null, review: false })
    expect(await read('?lang=zh-CN')).toEqual({ lang: 'zh', review: false })
    expect(await read('?lang=zh-TW', 'zh')).toEqual({ lang: null, review: false })
    expect(await read('', 'en-US,en;q=0.9,zh-CN;q=0.8')).toEqual({ lang: 'zh', review: false })
    expect(await read('', 'zh-TW,en;q=0.9')).toEqual({ lang: null, review: false })
    expect(await read('?lang=all&include=review')).toEqual({ lang: 'all', review: true })
    expect(await read('?lang=ALL')).toEqual({ lang: 'all', review: false })
    expect(await read('')).toEqual({ lang: null, review: false })
  })
})
