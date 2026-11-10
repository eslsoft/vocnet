import { describe, expect, it } from 'vitest'
import { langQuerySchema, listLangQuerySchema } from './catalog'

describe('public lang query', () => {
  it('accepts all only on document reads [spec: public-view/list-language]', () => {
    expect(langQuerySchema.parse('ALL')).toBe('ALL')
    expect(listLangQuerySchema.parse('zh-CN')).toBe('zh-CN')
    expect(listLangQuerySchema.parse(undefined)).toBeUndefined()
    const rejected = listLangQuerySchema.safeParse('All')
    expect(rejected.success).toBe(false)
    expect(rejected.error?.issues[0]?.message).toContain('GET /v1/entries/{lemma}')
  })
})
