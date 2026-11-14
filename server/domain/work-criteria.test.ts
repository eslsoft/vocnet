import type { SenseId } from '@shared/facts'
import type { Gap } from '@shared/work'
import { describe, expect, it } from 'vitest'
import { GENERAL_LIMITS, limitsOf, NO_NAMED_NODES, planReview } from './fact-kinds'
import { workCriteria } from './work-criteria'

const sense = '00000000-0000-4000-8000-000000000001' as SenseId
const taxonomy = [
  { category: 'Home', topic: 'In the kitchen' },
  { category: 'Sport', topic: 'Football' },
]
const of = (gap: Gap, pos: 'noun' | 'adjective' | 'number' | null = 'noun') => workCriteria(gap, pos, taxonomy)

describe('workCriteria', () => {
  it('gives each item the review prompts and write rules of the facts that fill it [spec: work/claim-criteria]', () => {
    const synonyms = of({ type: 'synonyms', sense_id: sense }, 'adjective')
    const [synonym, antonym] = synonyms.fills
    expect(synonyms.fills.map((fill) => fill.claim)).toEqual(['relation synonym', 'relation antonym'])
    expect(synonym?.decision?.models).toEqual(['jev'])
    expect(synonym?.decision?.rule).toMatch(
      /^Each model scores every question from 0 to 1, and its score is the lowest answer\. A pass settles when every one of these scores is reached: jev \d\.\d\d\. Otherwise the LLM rubric decides, and its verdict is final\.$/,
    )
    expect(antonym?.decision?.models).toEqual(['jev'])
    expect(synonym?.rubric).toContain('Claimed type: synonym')
    expect(synonym?.rubric).toContain('"<word>" (adjective)')
    expect(synonym?.limits).toEqual(limitsOf('relation'))
    expect(synonyms.limits).toBe(GENERAL_LIMITS)
    // The rendering is cached by what it reads.
    expect(of({ type: 'synonyms', sense_id: sense }, 'adjective')).toBe(synonyms)

    const topics = of({ type: 'topics', sense_id: sense })
    const plan = planReview(
      'topic',
      { topic_id: '<topic>' as never },
      {
        subject: { lemma: '<word>', pos: 'noun', gloss: '<the gloss of the sense>', siblings: [] },
        target: null,
        topic: { category: '<category>', topic: '<topic>' },
        named: NO_NAMED_NODES,
      },
    )
    expect(topics.fills[0]?.rubric).toBe(plan.kind === 'review' ? plan.prompt.user : null)
    expect(topics.fills[0]?.decision?.rule).toContain('A pass settles when the mean score of')
    expect(of({ type: 'collocations', sense_id: sense }).fills[0]?.limits).toEqual(limitsOf('collocation'))
  })

  it('states when any decision model settles, and when the LLM judges alone [spec: work/claim-criteria]', () => {
    const translations = of({ type: 'translations', language: 'zh', missing: [] }, null)
    expect(translations.fills.map((fill) => fill.claim)).toEqual([
      'translation zh of a sense',
      'translation zh of a sentence (an example or a saying)',
      'translation zh of a collocation',
    ])
    const [equivalent, ...texts] = translations.fills
    expect(equivalent?.decision?.models).toEqual(['jev', 'luna'])
    expect(equivalent?.decision?.rule).toMatch(
      /A pass settles when any one of these scores is reached: jev \d\.\d\d, luna \d\.\d\d\./,
    )
    expect(texts.map((fill) => fill.decision)).toEqual([null, null])
    expect(of({ type: 'examples', sense_id: sense, count: 0, need: 1 }).fills[0]?.decision).toBeNull()
  })

  it('renders a reviewable standard for every type of item [spec: work/claim-criteria]', () => {
    const gaps: Array<[Gap, 'noun' | null, string[]]> = [
      [{ type: 'senses' }, null, ['senses (the whole inventory)']],
      [
        {
          type: 'forms',
          missing: [
            { type: 'past', pos: 'verb' },
            { type: 'past_participle', pos: 'verb' },
            { type: 'past', pos: 'adjective' },
          ],
        },
        null,
        ['form past', 'form past_participle'],
      ],
      [{ type: 'pronunciation', accents: ['us', 'uk'] }, null, ['pronunciation us', 'pronunciation uk']],
      [{ type: 'phrases' }, null, ['phrases (every phrase of the headword, typed)']],
      [{ type: 'sayings', missing: [] }, null, ['sentence_meaning of each saying']],
      [{ type: 'family' }, null, ['morphology of the derivative']],
      [{ type: 'morphology' }, null, ['morphology']],
      [{ type: 'syllables' }, null, ['syllables']],
      [{ type: 'form_pronunciations', forms: ['went'] }, null, ['form with its pronunciation']],
      [{ type: 'category', sense_id: sense }, 'noun', ['relation hypernym (everyday layer, no domain)']],
      [{ type: 'parts', sense_id: sense }, 'noun', ['relation part_of, from the part to this sense']],
      [
        { type: 'examples', sense_id: sense, count: 0, need: 2 },
        'noun',
        ['example (a sentence, by sentence_id or text)'],
      ],
      [{ type: 'topics', sense_id: sense }, 'noun', ['topic']],
      [{ type: 'grammar', sense_id: sense }, 'noun', ['grammar (a sample noun claim)']],
      [{ type: 'collocations', sense_id: sense }, 'noun', ['collocation']],
      [{ type: 'productive_use', missing: ['verb'] }, null, []],
    ]
    for (const [gap, pos, claims] of gaps) {
      const criteria = of(gap, pos)
      expect(criteria.fills.map((fill) => fill.claim)).toEqual(claims)
      for (const fill of criteria.fills) expect(fill.rubric.length).toBeGreaterThan(100)
    }
    // A part of speech that takes no grammar has nothing to fill its grammar slot.
    expect(of({ type: 'grammar', sense_id: sense }, 'number').fills).toEqual([])
  })
})
