import type { SenseId } from '@shared/facts'
import { describe, expect, it } from 'vitest'
import { contentKeyOf, factKinds, planReview, targetOf } from './fact-kinds'

const target = '00000000-0000-4000-8000-000000000009' as SenseId
const bank = { lemma: 'bank', pos: 'noun' as const, gloss: 'land beside a river' }
const shore = { lemma: 'shore', pos: 'noun' as const, gloss: 'the land along the edge of water' }

describe('fact-kind registry', () => {
  it('derives dedupe keys from the identifying payload only', () => {
    expect(contentKeyOf('entry', {})).toBe('entry')
    expect(contentKeyOf('sense', { gloss: '  Land  beside a RIVER ' })).toBe('land beside a river')
    expect(contentKeyOf('form', { form: 'banks', type: 'plural' })).toBe('plural|banks')
    expect(contentKeyOf('relation', { type: 'synonym', target_sense_id: target })).toBe(`synonym|${target}`)
    expect(contentKeyOf('pronunciation', { ipa: 'bæŋk', accent: 'us' })).toBe('us|bæŋk')
    expect(contentKeyOf('example', { text: 'We sat on the Bank.' })).toBe('we sat on the bank.')
    expect(contentKeyOf('translation', { language: 'zh-Hans', text: '河岸' })).toBe('zh-Hans|河岸')
  })

  it('names the relation target as the object and no other kind has one', () => {
    expect(targetOf('relation', { type: 'antonym', target_sense_id: target })).toBe(target)
    expect(targetOf('example', { text: 'x' })).toBeNull()
  })

  it('routes checkable propositions to Jev and judgment calls to the LLM [spec: facts/reviewer-routing]', () => {
    const reviewers = Object.fromEntries(Object.entries(factKinds).map(([kind, spec]) => [kind, spec.reviewer]))
    expect(reviewers).toEqual({
      entry: 'jev',
      sense: 'jev',
      form: 'jev',
      relation: 'jev',
      pronunciation: 'llm',
      example: 'llm',
      translation: 'llm',
    })
  })

  it('asks Jev typed questions built from the review context', () => {
    expect(planReview('entry', {}, { subject: { lemma: 'bank' }, target: null })).toMatchObject({
      kind: 'review',
      request: { reviewer: 'jev', questions: { lemma: expect.stringContaining('"bank"') } },
    })
    const sense = planReview(
      'sense',
      { gloss: 'land beside a river' },
      { subject: { ...bank, gloss: null }, target: null },
    )
    expect(sense).toMatchObject({
      request: {
        questions: {
          lexical: expect.stringContaining('established noun sense of "bank" meaning "land beside a river"'),
        },
      },
    })
    const form = planReview('form', { form: 'banks', type: 'plural' }, { subject: { lemma: 'bank' }, target: null })
    expect(form).toMatchObject({ request: { questions: { form: expect.stringContaining('the plural form') } } })
  })

  it.each([
    ['synonym', 'denote the same thing'],
    ['antonym', 'conventional opposites'],
    ['hypernym', 'strict kind of the second'],
    ['part_of', 'normal constituent'],
  ] as const)('asks the qualified %s question about both glossed senses', (type, phrase) => {
    const plan = planReview('relation', { type, target_sense_id: target }, { subject: bank, target: shore })
    expect(plan).toMatchObject({ kind: 'review', request: { reviewer: 'jev' } })
    const question = plan.kind === 'review' && plan.request.reviewer === 'jev' ? plan.request.questions.relation : ''
    expect(question).toContain(phrase)
    expect(question).toContain('"bank" (noun), meaning "land beside a river", and "shore" (noun)')
  })

  it('cannot review a meaning-dependent fact against a sense without a gloss [spec: facts/unreviewable]', () => {
    const glossless = { ...bank, gloss: null }
    expect(planReview('example', { text: 'x' }, { subject: glossless, target: null })).toEqual({
      kind: 'unreviewable',
      reason: 'The referenced sense has no live gloss.',
    })
    expect(
      planReview(
        'relation',
        { type: 'synonym', target_sense_id: target },
        { subject: bank, target: { ...shore, gloss: null } },
      ),
    ).toMatchObject({ kind: 'unreviewable' })
    expect(
      planReview('relation', { type: 'synonym', target_sense_id: target }, { subject: bank, target: null }),
    ).toMatchObject({
      kind: 'unreviewable',
    })
  })

  it('gives the LLM a rubric prompt that demands a JSON verdict', () => {
    const plans = [
      planReview('pronunciation', { ipa: 'bæŋk', accent: 'uk' }, { subject: { lemma: 'bank' }, target: null }),
      planReview('example', { text: 'We sat on the bank.' }, { subject: bank, target: null }),
      planReview('translation', { language: 'fr', text: 'rive' }, { subject: bank, target: null }),
    ]
    const prompts = plans.map((plan) =>
      plan.kind === 'review' && plan.request.reviewer === 'llm' ? plan.request.prompt : null,
    )
    expect(prompts.every((prompt) => prompt?.system.includes('"verdict"'))).toBe(true)
    expect(prompts[0]?.user).toContain('British Received Pronunciation')
    expect(prompts[1]?.user).toContain('"We sat on the bank."')
    expect(prompts[2]?.user).toContain('"fr"')
  })
})
