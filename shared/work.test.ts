import { describe, expect, it } from 'vitest'
import { claimWorkInputSchema, completeWorkInputSchema, DEFAULT_CLAIM_ITEMS, workTypeSchema } from './work'

const item = '00000000-0000-4000-8000-000000000001'

describe('work wire', () => {
  it('names every gap type and weak_fact as a work type, and bounds a claim [spec: work/claim-one-type]', () => {
    expect(workTypeSchema.options).toContain('category')
    expect(workTypeSchema.options).toContain('weak_fact')
    expect(workTypeSchema.options).not.toContain('relations')
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
})
