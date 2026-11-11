import { describe, expect, it } from 'vitest'
import {
  exampleTranslation,
  frequencyBand,
  grammarCodes,
  grammarPatterns,
  jqPath,
  sliceAt,
  translationList,
  wordPath,
} from './entry-format'

const grammar = (fields: Record<string, unknown>) => ({ patterns: [], prepositions: [], ...fields }) as never

describe('entry format', () => {
  it('writes grammar as a learner’s dictionary codes it', () => {
    expect(grammarCodes(grammar({ countability: 'both', number: 'singular_only', article: 'with_the' }))).toEqual([
      'countable, uncountable',
      'singular',
      'usually the',
    ])
    expect(grammarCodes(grammar({ transitivity: 'both' }))).toEqual(['transitive, intransitive'])
    expect(grammarCodes(grammar({ transitivity: 'intransitive', position: 'mid' }))).toEqual([
      'intransitive',
      'mid position',
    ])
    expect(grammarCodes(grammar({ position: 'both', agreement: ['plural_noun', 'of_plural'] }))).toEqual([
      'with plural noun, of + plural',
    ])
    expect(grammarCodes(grammar({ countability: 'novel_code' }))).toEqual(['novel code'])
    expect(
      grammarPatterns(grammar({ patterns: ['that_clause', 'invented_pattern'], prepositions: ['on', 'upon'] })),
    ).toEqual(['~ that…', '~ invented pattern', '~ on', '~ upon'])
  })

  it('bands Zipf frequency from rare to core', () => {
    expect([7, 5.5, 4.2, 3.1, 1].map(frequencyBand)).toEqual([5, 4, 3, 2, 1])
  })

  it('addresses slices of the wire as jq does', () => {
    const payload = { meanings: [{ senses: [{ id: 'a' }, { id: 'b' }] }] }
    expect(jqPath([])).toBe('.')
    expect(jqPath(['meanings', 0, 'senses', 1])).toBe('.meanings[0].senses[1]')
    expect(sliceAt(payload, ['meanings', 0, 'senses', 1])).toEqual({ id: 'b' })
    expect(sliceAt(payload, [])).toBe(payload)
  })

  it('reads translations in one language or keyed by language', () => {
    expect(translationList(undefined)).toEqual([])
    expect(translationList(['动物'])).toEqual(['动物'])
    expect(translationList({ zh: ['动物', '牲畜'] })).toEqual(['动物', '牲畜'])
    expect(exampleTranslation(undefined)).toBeUndefined()
    expect(exampleTranslation('一句')).toBe('一句')
    expect(exampleTranslation({ zh: '一句' })).toBe('一句')
  })

  it('links a word, optionally at one of its senses', () => {
    expect(wordPath('ice cream')).toBe('/words/ice%20cream')
    expect(wordPath('bird', 's1')).toBe('/words/bird#sense-s1')
  })
})
