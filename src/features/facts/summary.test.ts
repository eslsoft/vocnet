import type { FactDto } from '@shared/facts'
import { describe, expect, it } from 'vitest'
import { fact } from '@/test/console-api'
import { summarizeFact } from './summary'

const target = '7d3b2a10-0000-4000-8000-000000000000'

describe('summarizeFact', () => {
  it.each([
    [{ kind: 'entry', payload: {} }, ''],
    [{ kind: 'sense', payload: { gloss: 'land beside a river' } }, 'land beside a river'],
    [{ kind: 'form', payload: { form: 'banks', type: 'plural' } }, 'banks (plural)'],
    [{ kind: 'relation', payload: { type: 'synonym', target_sense_id: target } }, 'synonym → sense 7d3b2a10'],
    [{ kind: 'pronunciation', payload: { ipa: 'bæŋk', accent: 'us' } }, '/bæŋk/ (us)'],
    [{ kind: 'sense', payload: { gloss: 'Semen.', register: 'taboo' } }, 'Semen. (taboo)'],
    [{ kind: 'form', payload: { form: 'would', type: 'past', pos: 'auxiliary' } }, 'would (past, auxiliary)'],
    [
      { kind: 'pronunciation', payload: { ipa: 'tə', accent: 'us', strength: 'weak', pos: 'preposition' } },
      '/tə/ (us, weak, preposition)',
    ],
    [{ kind: 'example', payload: { text: 'We sat on the bank.' } }, 'We sat on the bank.'],
    [{ kind: 'translation', payload: { language: 'zh', text: '河岸' } }, 'zh: 河岸'],
    [{ kind: 'topic', payload: { topic_id: 'hospital' } }, 'hospital'],
    [{ kind: 'grammar', payload: { countability: 'countable' } }, 'countable'],
    [
      { kind: 'grammar', payload: { transitivity: 'both', patterns: ['to_infinitive', 'that_clause'] } },
      'both, to_infinitive, that_clause',
    ],
    [
      { kind: 'grammar', payload: { transitivity: 'intransitive', prepositions: ['on', 'upon'] } },
      'intransitive, on, upon',
    ],
    [
      {
        kind: 'morphology',
        payload: {
          parts: [
            { form: 'spect', role: 'root', meaning: 'look' },
            { form: '-ator', role: 'suffix' },
          ],
        },
      },
      'spect "look" + -ator',
    ],
    [
      { kind: 'collocation', payload: { text: 'make a decision', pattern: 'verb_noun' } },
      'make a decision (verb_noun)',
    ],
    [{ kind: 'sense_list', payload: { common: [target, target], extra: [target] } }, '2 common, 1 extra'],
    [{ kind: 'syllables', payload: { syllables: ['a', 'bil', 'i', 'ty'] } }, 'a·bil·i·ty'],
    [{ kind: 'sense', payload: { gloss: 'A lorry.', region: 'british' } }, 'A lorry. (british)'],
    [{ kind: 'grammar', payload: { agreement: ['singular_noun', 'of_plural'] } }, 'singular_noun, of_plural'],
    [{ kind: 'grammar', payload: { position: 'mid' } }, 'mid'],
    [
      {
        kind: 'morphology',
        payload: {
          parts: [
            { form: 'study', role: 'base', lemma: 'study' },
            { form: '-ent', role: 'suffix' },
          ],
        },
      },
      'study → study + -ent',
    ],
    [
      {
        kind: 'morphology',
        payload: { parts: [{ form: 'Mrs', role: 'base' }], shortened: { type: 'abbreviation', of: 'mistress' } },
      },
      'Mrs (abbreviation of mistress)',
    ],
    [
      { kind: 'grammar', payload: { countability: 'uncountable', number: 'singular_only', article: 'with_the' } },
      'uncountable, singular_only, with_the',
    ],
    [
      { kind: 'gap_closure', payload: { gap: 'collocations', reason: 'A month name has no common collocations.' } },
      'collocations: A month name has no common collocations.',
    ],
    [{ kind: 'form', payload: { form: 'went', type: 'past', ipa: 'went', accent: 'uk' } }, 'went (past) /went/ (uk)'],
    [
      { kind: 'example', payload: { text: 'We sat on the bank.', translations: { zh: '我们坐在河岸上。' } } },
      'We sat on the bank. · zh: 我们坐在河岸上。',
    ],
  ])('summarizes a %o fact', (input, expected) => {
    expect(summarizeFact(fact(input as FactDto))).toBe(expected)
  })
})
