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
    [{ kind: 'translation', payload: { language: 'zh-Hans', text: '河岸' } }, 'zh-Hans: 河岸'],
    [{ kind: 'topic', payload: { topic_id: 'hospital' } }, 'hospital'],
  ])('summarizes a %o fact', (input, expected) => {
    expect(summarizeFact(fact(input as FactDto))).toBe(expected)
  })
})
