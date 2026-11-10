import { describe, expect, it } from 'vitest'
import { curationEvents, curatorReview, isCurated } from './curation'
import { canApply, factTransitions } from './fact-lifecycle'

describe('curation', () => {
  it('moves pending or published facts to published on pass and to rejected on fail [spec: curation/lifecycle]', () => {
    expect(factTransitions[curationEvents.pass]).toEqual({ from: ['pending', 'published'], to: 'published' })
    expect(factTransitions[curationEvents.fail]).toEqual({ from: ['pending', 'published'], to: 'rejected' })
    expect(canApply('curate_pass', 'rejected')).toBe(false)
    expect(canApply('curate_fail', 'rejected')).toBe(false)
    expect(canApply('curate_pass', 'superseded')).toBe(false)
  })

  it('records a certain review that names the curator and marks the fact curated', () => {
    const review = curatorReview({ kind: 'admin', sub: 's1' }, 'fail', 'Not a word.', '2026-01-01T00:00:00.000Z')
    expect(review).toMatchObject({ reviewer: 'curator', model: 'admin:s1', verdict: 'fail', confidence: 1 })
    expect(isCurated({ review })).toBe(true)
    expect(isCurated({ review: { ...review, reviewer: 'llm' } })).toBe(false)
    expect(isCurated({ review: null })).toBe(false)
  })
})
