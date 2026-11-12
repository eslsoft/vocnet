import { describe, expect, it } from 'vitest'
import { canApply, decide, isLive } from './fact-lifecycle'

describe('fact lifecycle', () => {
  it('publishes passing and uncertain reviews and rejects only failures [spec: facts/publish-with-flaws]', () => {
    expect(decide('pass')).toBe('publish')
    expect(decide('uncertain')).toBe('publish')
    expect(decide('fail')).toBe('reject')
  })

  it('rejects a fact whose context leaves nothing to judge', () => {
    expect(decide('unreviewable')).toBe('reject')
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
    expect(canApply('curate_pass', 'published')).toBe(true)
    expect(canApply('curate_fail', 'rejected')).toBe(false)
  })

  it('treats pending and published facts as live', () => {
    expect(['pending', 'published', 'rejected', 'superseded', 'retracted'].filter((s) => isLive(s as never))).toEqual([
      'pending',
      'published',
    ])
  })
})
