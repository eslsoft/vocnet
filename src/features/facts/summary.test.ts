import type { FactDto } from '@shared/facts'
import { describe, expect, it } from 'vitest'
import { fact } from '@/test/console-api'
import { summarizeFact } from './summary'

const target = '7d3b2a10-0000-4000-8000-000000000000'

describe('summarizeFact', () => {
  it.each([
    [
      {
        kind: 'senses',
        payload: {
          senses: [
            { id: target, pos: 'noun', gloss: 'land beside a river', rank: 'common' },
            { id: target, pos: 'noun', gloss: 'a money business', rank: 'common' },
            { id: target, pos: 'verb', gloss: 'to tilt a plane', rank: 'extra' },
          ],
        },
      },
      '2 common, 1 extra',
    ],
    [{ kind: 'form', payload: { form: 'banks', type: 'plural' } }, 'banks (plural)'],
    [{ kind: 'relation', payload: { type: 'synonym', target_sense_id: target } }, 'synonym → sense 7d3b2a10'],
    [{ kind: 'pronunciation', payload: { ipa: 'bæŋk', accent: 'us' } }, '/bæŋk/ (us)'],
    [{ kind: 'form', payload: { form: 'would', type: 'past', pos: 'auxiliary' } }, 'would (past, auxiliary)'],
    [
      { kind: 'pronunciation', payload: { ipa: 'tə', accent: 'us', strength: 'weak', pos: 'preposition' } },
      '/tə/ (us, weak, preposition)',
    ],
    [{ kind: 'example', payload: { text: 'We sat on the bank.' } }, 'We sat on the bank.'],
    [{ kind: 'translation', payload: { language: 'zh', of: 'sense', text: '河岸' } }, 'zh (sense): 河岸'],
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
    [{ kind: 'phrases', payload: { phrases: ['bank on', 'break the bank'] } }, 'bank on · break the bank'],
    [{ kind: 'syllables', payload: { syllables: ['a', 'bil', 'i', 'ty'] } }, 'a·bil·i·ty'],
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
    [{ kind: 'form', payload: { form: 'went', type: 'past', ipa: 'went', accent: 'uk' } }, 'went (past) /went/ (uk)'],
  ])('summarizes a %o fact', (input, expected) => {
    expect(summarizeFact(fact(input as FactDto))).toBe(expected)
  })
})
