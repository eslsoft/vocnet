import { describe, expect, it } from 'vitest'
import { canApply, decide, isLive, jevVerdict, reviewEffects, reviewModeOf } from './fact-lifecycle'

describe('fact lifecycle', () => {
  it('publishes passing and uncertain reviews and rejects only failures [spec: facts/publish-with-flaws]', () => {
    expect(decide('review', 'pass')).toBe('publish')
    expect(decide('review', 'uncertain')).toBe('publish')
    expect(decide('review', 'fail')).toBe('reject')
  })

  it('keeps a revalidated fact published unless its new review fails [spec: facts/revalidation-outcome]', () => {
    expect(['pass', 'uncertain', 'fail'].map((verdict) => decide('revalidation', verdict as never))).toEqual([
      'reconfirm',
      'reconfirm',
      'invalidate',
    ])
    expect(decide('revalidation', 'unreviewable')).toBe('release')
    expect(decide('review', 'unreviewable')).toBe('reject')
    expect(reviewEffects.release).toEqual({ outcome: 'published', records: false })
    expect(canApply('release', 'published')).toBe(true)
    expect(canApply('reconfirm', 'published')).toBe(true)
    expect(canApply('invalidate', 'published')).toBe(true)
    expect(canApply('invalidate', 'pending')).toBe(false)
  })

  it('reviews pending facts and published facts marked for revalidation, nothing else', () => {
    const at = '2026-01-01T00:00:00.000Z'
    expect(reviewModeOf({ status: 'pending', revalidateSince: null })).toBe('review')
    expect(reviewModeOf({ status: 'published', revalidateSince: at })).toBe('revalidation')
    expect(reviewModeOf({ status: 'published', revalidateSince: null })).toBeNull()
    expect(reviewModeOf({ status: 'rejected', revalidateSince: at })).toBeNull()
  })

  it('allows only the transitions in the state machine', () => {
    expect(canApply('publish', 'pending')).toBe(true)
    expect(canApply('publish', 'published')).toBe(false)
    expect(canApply('reject', 'rejected')).toBe(false)
    expect(canApply('supersede', 'published')).toBe(true)
    expect(canApply('supersede', 'pending')).toBe(false)
    expect(canApply('retract', 'pending')).toBe(true)
    expect(canApply('retract', 'superseded')).toBe(false)
    expect(canApply('rereview', 'rejected')).toBe(true)
    expect(canApply('rereview', 'retracted')).toBe(false)
  })

  it('treats pending and published facts as live', () => {
    expect(['pending', 'published', 'rejected', 'superseded', 'retracted'].filter((s) => isLive(s as never))).toEqual([
      'pending',
      'published',
    ])
  })
})

describe('Jev verdict policy', () => {
  it('passes when every answer is at least 0.8, with the weakest answer as confidence [spec: facts/jev-policy]', () => {
    expect(jevVerdict({ a: 0.8, b: 0.97 })).toEqual({ verdict: 'pass', confidence: 0.8 })
  })

  it('fails when any answer is below 0.5 [spec: facts/jev-policy]', () => {
    expect(jevVerdict({ a: 0.99, b: 0.44 })).toEqual({ verdict: 'fail', confidence: 0.44 })
  })

  it('is uncertain from 0.5 up to 0.8 [spec: facts/jev-policy]', () => {
    expect(jevVerdict({ a: 0.99, b: 0.5 })).toEqual({ verdict: 'uncertain', confidence: 0.5 })
    expect(jevVerdict({ a: 0.79 })).toEqual({ verdict: 'uncertain', confidence: 0.79 })
  })
})
