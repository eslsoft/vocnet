import type { Review } from '@shared/facts'
import { describe, expect, it } from 'vitest'
import { factCredibility, passCredibility, reviewPath } from './credibility'

const review = (reviewer: Review['reviewer']): Review => ({
  reviewer,
  model: 'm',
  verdict: 'pass',
  confidence: 0.9,
  reason: 'r',
  context: {},
  detail: {},
  reviewed_at: '2026-01-01T00:00:00.000Z',
})

describe('credibility', () => {
  it('names the path that settled a fact [spec: work/credibility]', () => {
    expect(reviewPath({ review: null })).toBeNull()
    expect(reviewPath({ review: review('curator') })).toBe('curator')
    expect(reviewPath({ review: review('llm') })).toBe('llm')
    expect(['jev', 'luna', 'jev+luna'].map((reviewer) => reviewPath({ review: review(reviewer as never) }))).toEqual([
      'decision',
      'decision',
      'decision',
    ])
    expect(
      ['jev+llm', 'luna+llm', 'jev+luna+llm'].map((reviewer) => reviewPath({ review: review(reviewer as never) })),
    ).toEqual(['decision_llm', 'decision_llm', 'decision_llm'])
  })

  it('rates a fact by how often its kind and path are right [spec: work/credibility]', () => {
    expect(factCredibility({ kind: 'relation', review: null })).toBeNull()
    expect(factCredibility({ kind: 'relation', review: review('curator') })).toBe(1)
    expect(factCredibility({ kind: 'relation', review: review('jev') })).toBe(0.97)
    expect(factCredibility({ kind: 'relation', review: review('jev+llm') })).toBe(0.88)
    expect(factCredibility({ kind: 'relation', review: review('llm') })).toBe(0.77)
    expect(factCredibility({ kind: 'senses', review: review('llm') })).toBe(0.7)
    expect(factCredibility({ kind: 'morphology', review: review('llm') })).toBe(0.99)
  })

  it('ranks an optional slot a pass left empty below a decision pass [spec: work/credibility]', () => {
    expect(passCredibility('synonyms')).toBe(0.8)
    expect(passCredibility('phrases')).toBeLessThan(factCredibility({ kind: 'relation', review: review('jev') }) ?? 0)
  })
})
