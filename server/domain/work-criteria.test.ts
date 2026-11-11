import type { FactId, SenseId } from '@shared/facts'
import type { Gap } from '@shared/work'
import { describe, expect, it } from 'vitest'
import type { Fact } from './fact'
import { GENERAL_LIMITS, limitsOf, planReview } from './fact-kinds'
import { workCriteria } from './work-criteria'

const sense = '00000000-0000-4000-8000-000000000001' as SenseId
const taxonomy = [
  { category: 'Home', topic: 'In the kitchen' },
  { category: 'Sport', topic: 'Football' },
]
const of = (gap: Gap, pos: 'noun' | 'adjective' | null = 'noun', weak: Fact | null = null) =>
  workCriteria(gap, pos, weak, taxonomy)

describe('workCriteria', () => {
  it('gives each item the review prompts and write rules of the facts that fill it and of its closure [spec: work/claim-criteria]', () => {
    const kinds = (gap: Gap) => of(gap).fills.map((fill) => fill.claim)
    expect(kinds({ type: 'synonyms', sense_id: sense })).toEqual(['relation synonym', 'relation antonym'])
    expect(kinds({ type: 'category', sense_id: sense })).toEqual(['relation hypernym (everyday layer, no domain)'])
    expect(kinds({ type: 'parts', sense_id: sense })).toEqual(['relation part_of, from the part to this sense'])
    expect(kinds({ type: 'topics', sense_id: sense })).toEqual(['topic'])
    expect(
      kinds({
        type: 'forms',
        missing: [
          { type: 'past', pos: 'verb' },
          { type: 'past_participle', pos: 'verb' },
        ],
      }),
    ).toEqual(['form past', 'form past_participle'])
    expect(kinds({ type: 'sense_list', senses: [] })).toEqual(['sense_list'])

    const synonyms = of({ type: 'synonyms', sense_id: sense }, 'adjective')
    const [synonym, antonym] = synonyms.fills
    expect(synonym?.jev?.rule).toBe(
      'Jev scores each question from 0 to 1. When every score is 0.8 or more the fact passes without the LLM. A Jev score below 0.5 fails without appeal. Otherwise the LLM rubric decides.',
    )
    expect(synonym?.jev?.questions[0]).toContain('do these terms denote the same thing or action in both directions')
    expect(antonym?.jev).toBeNull()
    expect(synonym?.rubric).toContain('Claimed type: synonym')
    expect(synonym?.rubric).toContain('Source: "<word>" (adjective), meaning "<the gloss of the sense>".')
    expect(synonym?.limits).toEqual(limitsOf('relation'))
    expect(synonym?.limits).toContainEqual(expect.stringContaining('one relation type only'))
    expect(synonyms.limits).toBe(GENERAL_LIMITS)
    expect(synonyms.limits).toContainEqual(expect.stringContaining('Only a published fact can be superseded'))
    expect(synonyms.closure).toContain('Slot: a synonym or an antonym')
    expect(synonyms.closure).toContain('Claimed reason it is empty: "<your reason>".')
    expect(synonyms.closure).not.toContain('fixed taxonomy')
    // The rules that weigh a slot's history never show without that history.
    expect(synonyms.closure).not.toContain('Review already rejected')
    expect(synonyms.closure).not.toContain('keeps each from being recorded')

    const topics = of({ type: 'topics', sense_id: sense })
    expect(topics.fills[0]?.rubric).toBe(
      (() => {
        const plan = planReview(
          'topic',
          { topic_id: '<topic>' as never },
          {
            subject: { lemma: '<word>', pos: 'noun', gloss: '<the gloss of the sense>', siblings: [] },
            target: null,
            topic: { category: '<category>', topic: '<topic>' },
            attempts: [],
            taxonomy: [],
            blocked: [],
          },
        )
        return plan.kind === 'review' ? plan.requests[0]?.reviewer === 'llm' && plan.requests[0].prompt.user : null
      })(),
    )
    expect(topics.fills[0]?.limits).toEqual([expect.stringContaining('at most 3 live topics')])
    expect(topics.closure).toContain('- In the kitchen (Home)\n- Football (Sport)')
    expect(of({ type: 'examples', sense_id: sense, count: 0, need: 1 }).closure).toBeNull()
    expect(of({ type: 'phrases', have: [], need: 3 }, null).closure).toContain('Slot: three phrasal verbs')
    expect(of({ type: 'collocations', sense_id: sense }).fills[0]?.limits).toEqual(limitsOf('collocation'))
    expect(of({ type: 'synonyms', sense_id: sense }, 'adjective')).toBe(synonyms)
  })

  it('renders a reviewable standard for every type of item [spec: work/claim-criteria]', () => {
    const gaps: Array<[Gap, 'noun' | null, string[]]> = [
      [{ type: 'senses' }, null, ['sense', 'sense_list']],
      [{ type: 'pronunciation', accents: ['us', 'uk'] }, null, ['pronunciation us', 'pronunciation uk']],
      [{ type: 'phrases', have: [], need: 3 }, null, ['entry of the phrase', 'verb sense of the phrase']],
      [{ type: 'family' }, null, ['entry of the derivative', 'morphology of the derivative']],
      [{ type: 'morphology' }, null, ['morphology']],
      [{ type: 'syllables' }, null, ['syllables']],
      [{ type: 'form_pronunciations', forms: ['went'] }, null, ['form with its pronunciation']],
      [{ type: 'examples', sense_id: sense, count: 0, need: 2 }, 'noun', ['example']],
      [{ type: 'translations', sense_id: sense, language: 'zh' }, 'noun', ['translation zh']],
      [
        { type: 'example_translations', sense_id: sense, language: 'zh', examples: [] },
        'noun',
        ['example with its zh translation'],
      ],
      [{ type: 'grammar', sense_id: sense }, 'noun', ['grammar (a sample noun claim)']],
      [{ type: 'collocations', sense_id: sense }, 'noun', ['collocation']],
    ]
    for (const [gap, pos, claims] of gaps) {
      const criteria = of(gap, pos)
      expect(criteria.fills.map((fill) => fill.claim)).toEqual(claims)
      for (const fill of criteria.fills) expect(fill.rubric.length).toBeGreaterThan(100)
    }
    expect(of({ type: 'grammar', sense_id: sense }, null).fills).toHaveLength(1)
    expect(workCriteria({ type: 'grammar', sense_id: sense }, 'number', null, taxonomy).fills).toEqual([])
  })

  it('renders a weak fact with its own payload, never from the cache [spec: work/claim-criteria]', () => {
    const weak = {
      id: '00000000-0000-4000-8000-000000000009' as FactId,
      kind: 'grammar',
      subjectId: sense,
      objectId: null,
      contentKey: 'k',
      payload: { countability: 'uncountable' },
      status: 'published',
      supersedesId: null,
      author: 'agent:a',
      review: null,
      revalidateSince: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    } as Fact
    const gap: Gap = { type: 'weak_fact', fact_id: weak.id, kind: 'grammar', reason: 'uncertain' }
    const criteria = of(gap, 'noun', weak)
    expect(criteria.fills.map((fill) => fill.claim)).toEqual(['correction of the grammar'])
    expect(criteria.fills[0]?.rubric).toContain('uncountable')
    expect(criteria.closure).toBeNull()
    expect(of(gap, 'noun', weak)).not.toBe(criteria)
    expect(of(gap, 'noun', null).fills).toEqual([])
  })
})
