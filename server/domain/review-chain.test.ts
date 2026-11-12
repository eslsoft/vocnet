import { describe, expect, it } from 'vitest'
import type { DecisionRequest } from './fact-kinds'
import {
  chainVerdict,
  DECISION_FAIL_BELOW,
  decisionOpinion,
  decisionSettles,
  type Opinion,
  scoreOf,
} from './review-chain'

const jev: Opinion = {
  reviewer: 'jev',
  model: 'jev-test',
  verdict: 'uncertain',
  confidence: 0.6,
  reason: 'Jev relation=0.6',
  detail: { answers: { relation: 0.6 } },
}
const luna: Opinion = { ...jev, reviewer: 'luna', model: 'luna-test', reason: 'luna relation=0.6' }
const llm: Opinion = {
  reviewer: 'llm',
  model: 'llm-test',
  verdict: 'pass',
  confidence: 0.9,
  reason: 'Fine.',
  detail: {},
}

const request = (combine: DecisionRequest['combine'], jevAt: number, lunaAt?: number): DecisionRequest => ({
  gates:
    lunaAt === undefined
      ? [{ model: 'jev', passAt: jevAt }]
      : [
          { model: 'jev', passAt: jevAt },
          { model: 'luna', passAt: lunaAt },
        ],
  combine,
  state: {},
  questions: { claim: 'Is it?' },
})
const scores = (jevScore: number, lunaScore: number) =>
  new Map([
    ['jev', jevScore],
    ['luna', lunaScore],
  ] as const)

describe('decision opinions', () => {
  it('scores a model by its weakest answer [spec: facts/jev-policy]', () => {
    expect(scoreOf({ model: 'jev-test', answers: { a: 0.8, b: 0.97 } })).toBe(0.8)
  })

  it('passes at the threshold, fails under the floor, and is uncertain between [spec: facts/jev-policy]', () => {
    const opinion = (answers: Record<string, number>) => decisionOpinion('jev', 0.9, { model: 'jev-test', answers })
    expect(opinion({ a: 0.9, b: 0.99 })).toEqual({
      reviewer: 'jev',
      model: 'jev-test',
      verdict: 'pass',
      confidence: 0.9,
      reason: 'Jev a=0.9, b=0.99',
      detail: { answers: { a: 0.9, b: 0.99 } },
    })
    expect(opinion({ a: 0.89 }).verdict).toBe('uncertain')
    expect(opinion({ a: DECISION_FAIL_BELOW }).verdict).toBe('uncertain')
    expect(opinion({ a: 0.49 }).verdict).toBe('fail')
  })

  it('names luna in its reason and rounds each answer to two places', () => {
    expect(decisionOpinion('luna', 0.8, { model: 'luna-test', answers: { syllables: 0.8765 } }).reason).toBe(
      'luna syllables=0.88',
    )
  })
})

describe('decision settling', () => {
  it('settles min only when every model reaches its threshold [spec: facts/second-opinion]', () => {
    const min = request('min', 0.8, 0.9)
    expect(decisionSettles(min, scores(0.8, 0.9))).toBe(true)
    expect(decisionSettles(min, scores(0.99, 0.89))).toBe(false)
  })

  it('settles any when one model reaches its threshold [spec: facts/second-opinion]', () => {
    const any = request('any', 0.8, 0.8)
    expect(decisionSettles(any, scores(0.1, 0.8))).toBe(true)
    expect(decisionSettles(any, scores(0.79, 0.79))).toBe(false)
  })

  it('settles mean when the mean score reaches the mean threshold [spec: facts/second-opinion]', () => {
    const mean = request('mean', 0.8, 0.8)
    expect(decisionSettles(mean, scores(0.7, 0.9))).toBe(true)
    expect(decisionSettles(mean, scores(0.7, 0.89))).toBe(false)
  })

  it('counts a model without a score as zero', () => {
    expect(decisionSettles(request('min', 0.8), scores(0.8, 0))).toBe(true)
    expect(decisionSettles(request('any', 0.8, 0.8), new Map())).toBe(false)
    expect(decisionSettles(request('mean', 0.4, 0.4), new Map([['jev', 0.8]]))).toBe(true)
    expect(decisionSettles(request('mean', 0.4, 0.4), new Map([['jev', 0.79]]))).toBe(false)
  })
})

describe('review chain', () => {
  it('keeps a lone opinion as the review', () => {
    expect(chainVerdict([llm])).toEqual(llm)
  })

  it('records a settled pass with the combined decision score', () => {
    expect(chainVerdict([jev, luna], 0.85)).toEqual({
      reviewer: 'jev+luna',
      model: 'jev-test+luna-test',
      verdict: 'pass',
      confidence: 0.85,
      reason: 'Jev relation=0.6 | luna relation=0.6',
      detail: { opinions: [jev, luna] },
    })
  })

  it('decides by the LLM after an unsettled decision and records every opinion', () => {
    expect(chainVerdict([jev, llm])).toEqual({
      reviewer: 'jev+llm',
      model: 'jev-test+llm-test',
      verdict: 'pass',
      confidence: 0.9,
      reason: 'Jev relation=0.6 | Fine.',
      detail: { opinions: [jev, llm] },
    })
  })
})
