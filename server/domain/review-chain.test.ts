import { describe, expect, it } from 'vitest'
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
  it('lets Jev settle only a pass and the LLM settle every verdict [spec: facts/second-opinion]', () => {
    expect([settles('jev', 'pass'), settles('jev', 'uncertain'), settles('jev', 'fail')]).toEqual([true, false, false])
    expect([settles('llm', 'pass'), settles('llm', 'uncertain'), settles('llm', 'fail')]).toEqual([true, true, true])
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
