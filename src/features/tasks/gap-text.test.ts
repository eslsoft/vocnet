import type { FactId, SenseId } from '@shared/facts'
import type { Gap } from '@shared/work'
import { describe, expect, it } from 'vitest'
import i18n from '@/shared/i18n'
import { gapNeed, gapText } from './gap-text'

const t = i18n.getFixedT('en-US')
const sense = { sense_id: crypto.randomUUID() as SenseId }
const factId = crypto.randomUUID() as FactId

describe('gapText', () => {
  it.each<[Gap, string]>([
    [{ type: 'senses' }, 'No senses yet.'],
    [{ type: 'sense_list', senses: [] }, 'The senses are not in an agreed order yet.'],
    [
      {
        type: 'forms',
        missing: [
          { type: 'plural', pos: 'noun' },
          { type: 'past', pos: 'verb' },
        ],
      },
      'Missing forms: plural (noun), past (verb).',
    ],
    [{ type: 'pronunciation', accents: ['us', 'uk'] }, 'No pronunciation for US, UK yet.'],
    [{ type: 'phrases', have: ['give up'], need: 3 }, 'Has 1 phrasal verb. Core verbs need 3.'],
    [{ type: 'family' }, 'No word family yet.'],
    [{ type: 'morphology' }, 'No word formation yet.'],
    [{ type: 'syllables' }, 'No syllable division yet.'],
    [{ type: 'form_pronunciations', forms: ['went', 'gone'] }, 'No pronunciation for went, gone yet.'],
    [{ type: 'category', ...sense }, 'No category yet: what it is a kind of.'],
    [{ type: 'parts', ...sense }, 'No parts yet.'],
    [{ type: 'synonyms', ...sense }, 'No synonym or antonym yet.'],
    [{ type: 'examples', ...sense, count: 1, need: 2 }, 'Has 1 example. This sense needs 2.'],
    [{ type: 'translations', ...sense, language: 'zh' }, 'No Chinese translation yet.'],
    [
      { type: 'example_translations', ...sense, language: 'zh', examples: [factId, factId] },
      '2 examples have no Chinese translation.',
    ],
    [{ type: 'topics', ...sense }, 'No topic yet.'],
    [{ type: 'grammar', ...sense }, 'No grammar note yet.'],
    [{ type: 'collocations', ...sense }, 'No collocation yet.'],
    [
      { type: 'weak_fact', fact_id: factId, kind: 'example', reason: 'uncertain' },
      'Review was unsure about this Example.',
    ],
    [{ type: 'weak_fact', fact_id: factId, kind: 'sense', reason: 'feedback' }, 'A ticket reports this Sense.'],
    [
      { type: 'weak_fact', fact_id: factId, kind: 'sense', reason: 'failed' },
      'Review failed this Sense, but it is still shown.',
    ],
  ])('describes a %o gap in plain words', (gap, expected) => {
    expect(gapText(gap, t)).toBe(expected)
  })

  it('says what is still needed where a fact would go', () => {
    expect(gapNeed({ type: 'examples', ...sense, count: 1, need: 2 }, t)).toBe('Needs 1 more example')
    expect(gapNeed({ type: 'phrases', have: [], need: 3 }, t)).toBe('Needs 3 more phrasal verbs')
    expect(gapNeed({ type: 'topics', ...sense }, t)).toBe('No topic yet.')
  })
})
