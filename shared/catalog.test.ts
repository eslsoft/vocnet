import { describe, expect, it } from 'vitest'
import { entrySortSchema, langQuerySchema, levelFilterSchema, listLangQuerySchema, senseSortSchema } from './catalog'

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

describe('public list filters', () => {
  it('reads levels repeated or comma-separated and rejects unknown ones [spec: public-view/list-filters]', () => {
    expect(levelFilterSchema.parse('A1')).toEqual(['A1'])
    expect(levelFilterSchema.parse('A1,B2')).toEqual(['A1', 'B2'])
    expect(levelFilterSchema.parse(['A1', 'B1,C2'])).toEqual(['A1', 'B1', 'C2'])
    expect(levelFilterSchema.parse(undefined)).toBeUndefined()
    expect(levelFilterSchema.safeParse('a1').success).toBe(false)
    expect(levelFilterSchema.safeParse('A1,').success).toBe(false)
    expect(entrySortSchema.parse(undefined)).toBe('lemma')
    expect(senseSortSchema.parse('level')).toBe('level')
  })
})
