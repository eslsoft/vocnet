import { describe, expect, it } from 'vitest'
import type { ReviewRequest } from './fact-kinds'
import { chainVerdict, type Opinion, settles } from './review-chain'

const jev: Opinion = {
  reviewer: 'jev',
  model: 'jev-test',
  verdict: 'fail',
  confidence: 0.3,
  reason: 'Jev relation=0.3',
  detail: { answers: { relation: 0.3 } },
}
const llm: Opinion = {
  reviewer: 'llm',
  model: 'llm-test',
  verdict: 'pass',
  confidence: 0.9,
  reason: 'Fine.',
  detail: {},
}

describe('review chain', () => {
  const jevAsk: ReviewRequest = { reviewer: 'jev', questions: { relation: 'Is it?' } }
  const llmAsk: ReviewRequest = { reviewer: 'llm', prompt: { system: 'Judge.', user: 'Is it?' } }
  const answered = (verdict: Opinion['verdict'], confidence = 0.3): Opinion => ({ ...jev, verdict, confidence })

  it('lets Jev settle only a pass and the LLM settle every verdict [spec: facts/second-opinion]', () => {
    expect(
      ['pass', 'uncertain', 'fail'].map((verdict) => settles(jevAsk, answered(verdict as Opinion['verdict']))),
    ).toEqual([true, false, false])
    expect(
      ['pass', 'uncertain', 'fail'].map((verdict) => settles(llmAsk, answered(verdict as Opinion['verdict']))),
    ).toEqual([true, true, true])
    expect(settles(jevAsk, answered('fail', 0.01))).toBe(false)
  })

  it('lets a Jev fail under the request floor settle, and only under it [spec: facts/relation-jev-floor]', () => {
    const floored: ReviewRequest = { ...jevAsk, settlesFailBelow: 0.15 }
    expect(settles(floored, answered('fail', 0.09))).toBe(true)
    expect(settles(floored, answered('fail', 0.15))).toBe(false)
    expect(settles(floored, answered('fail', 0.3))).toBe(false)
  })

  it('keeps a lone opinion as the review', () => {
    expect(chainVerdict([jev])).toEqual(jev)
  })

  it('decides by the last opinion and records every one', () => {
    expect(chainVerdict([jev, llm])).toEqual({
      reviewer: 'jev+llm',
      model: 'jev-test+llm-test',
      verdict: 'pass',
      confidence: 0.9,
      reason: 'Jev relation=0.3 | Fine.',
      detail: { opinions: [jev, llm] },
    })
  })
})
