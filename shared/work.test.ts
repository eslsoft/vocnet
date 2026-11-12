import { describe, expect, it } from 'vitest'
import {
  claimWorkInputSchema,
  completeWorkInputSchema,
  DEFAULT_CLAIM_ITEMS,
  isOptionalGap,
  OPTIONAL_GAPS,
  workTypeSchema,
} from './work'

const item = '00000000-0000-4000-8000-000000000001'

describe('work wire', () => {
  it('names every gap type as a work type, and bounds a claim [spec: work/claim-one-type]', () => {
    expect(workTypeSchema.options).toContain('senses')
    expect(workTypeSchema.options).toContain('translations')
    expect(workTypeSchema.options).not.toContain('weak_fact')
    expect(workTypeSchema.options).not.toContain('sense_list')
    expect(claimWorkInputSchema.parse({})).toEqual({ limit: DEFAULT_CLAIM_ITEMS })
    expect(claimWorkInputSchema.safeParse({ types: ['category', 'category'] }).error?.issues[0]?.message).toBe(
      'Each type is listed once.',
    )
    expect(completeWorkInputSchema.parse({ items: [{ id: item, note: ' Done. ' }] })).toEqual({
      items: [{ id: item, note: 'Done.' }],
    })
    expect(completeWorkInputSchema.safeParse({ items: [{ id: item }, { id: item }] }).error?.issues[0]?.message).toBe(
      'Each item is listed once.',
    )
  })

  it('makes a found_none pass say what it considered, and names the optional slots [spec: work/found-none]', () => {
    expect(
      completeWorkInputSchema.safeParse({ items: [{ id: item, found_none: true }] }).error?.issues[0]?.message,
    ).toBe('An item completed with found_none gives a note saying what was considered.')
    expect(
      completeWorkInputSchema.parse({
        items: [{ id: item, found_none: true, note: 'No synonym fits.', blocked_on: ['riverside'] }],
      }),
    ).toEqual({ items: [{ id: item, found_none: true, note: 'No synonym fits.', blocked_on: ['riverside'] }] })
    expect(OPTIONAL_GAPS.every(isOptionalGap)).toBe(true)
    expect(['senses', 'examples', 'translations', 'forms'].some((type) => isOptionalGap(type as never))).toBe(false)
  })
})
