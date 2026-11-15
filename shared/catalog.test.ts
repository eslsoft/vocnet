import { describe, expect, it } from 'vitest'
import {
  entrySortSchema,
  langQuerySchema,
  levelFilterSchema,
  listLangQuerySchema,
  OVERVIEW_MAX_LEMMAS,
  overviewLemmasSchema,
  overviewSensesSchema,
  senseSortSchema,
} from './catalog'

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

describe('overview query', () => {
  it('reads lemmas one or repeated, never split at a comma, within the limit [spec: public-view/overviews]', () => {
    expect(overviewLemmasSchema.parse('bright')).toBe('bright')
    expect(overviewLemmasSchema.parse([' run ', 'easy come, easy go'])).toEqual(['run', 'easy come, easy go'])
    expect(overviewLemmasSchema.safeParse(undefined).success).toBe(false)
    expect(overviewLemmasSchema.safeParse(['run', ' ']).success).toBe(false)
    const lemmas = (count: number) => Array.from({ length: count }, (_, at) => `w${at}`)
    expect(overviewLemmasSchema.parse(lemmas(OVERVIEW_MAX_LEMMAS))).toHaveLength(OVERVIEW_MAX_LEMMAS)
    expect(overviewLemmasSchema.safeParse(lemmas(OVERVIEW_MAX_LEMMAS + 1)).success).toBe(false)
    expect(overviewSensesSchema.parse(undefined)).toBe(4)
    expect(overviewSensesSchema.parse('2')).toBe(2)
    expect(overviewSensesSchema.safeParse('0').success).toBe(false)
    expect(overviewSensesSchema.safeParse('11').success).toBe(false)
  })
})
