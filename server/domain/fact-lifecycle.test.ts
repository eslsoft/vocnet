import { describe, expect, it } from 'vitest'
import { canApply, decide, isLive, jevVerdict } from './fact-lifecycle'

describe('fact lifecycle', () => {
  it('publishes passing and uncertain reviews and rejects only failures [spec: facts/publish-with-flaws]', () => {
    expect(decide('pass')).toBe('publish')
    expect(decide('uncertain')).toBe('publish')
    expect(decide('fail')).toBe('reject')
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

  it('fails when any answer is at most 0.2 [spec: facts/jev-policy]', () => {
    expect(jevVerdict({ a: 0.99, b: 0.2 })).toEqual({ verdict: 'fail', confidence: 0.2 })
  })

  it('is uncertain in between [spec: facts/jev-policy]', () => {
    expect(jevVerdict({ a: 0.99, b: 0.5 })).toEqual({ verdict: 'uncertain', confidence: 0.5 })
  })
})
