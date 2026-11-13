import { describe, expect, it } from 'vitest'
import { britishSpelling, filterHeadwords, regularBases } from './headword-import'
import type { Lemma } from './term'

const lemmas = (...words: string[]) => words as Lemma[]

describe('headword import filter', () => {
  it('reduces a regular inflection to a base that is a candidate or an entry, unless the list lists the form [spec: catalog/import-filter]', () => {
    expect(regularBases('stopped')).toContain('stop')
    expect(regularBases('making')).toContain('make')
    expect(regularBases('carries')).toContain('carry')
    expect(regularBases('happier')).toContain('happy')
    expect(regularBases('boxes')).toContain('box')
    expect(regularBases('glass')).not.toContain('glas')
    const entries = new Set(['walk'])
    const unlisted = filterHeadwords(
      lemmas('walked', 'cats', 'cat', 'tallest', 'went', "it's", 'x', 'Q&A', 'well-known'),
      {
        isEntry: (lemma) => entries.has(lemma),
        listed: (lemma) => lemma === 'went' || lemma === 'cat' || lemma === 'well-known',
      },
    )
    expect(unlisted.admit).toEqual(['cat', 'tallest', 'went', 'well-known'])
    expect(unlisted.skipped).toEqual({
      letters: ['x'],
      contractions: ["it's"],
      characters: ['Q&A'],
      inflections: [
        { lemma: 'walked', base: 'walk' },
        { lemma: 'cats', base: 'cat' },
      ],
      variants: [],
    })
    // A form the reference list lists stays a headword.
    expect(filterHeadwords(lemmas('cats', 'cat'), { isEntry: () => false, listed: () => true }).admit).toEqual([
      'cats',
      'cat',
    ])
  })

  it('merges an American spelling into its British one, never pairing two words [spec: catalog/import-filter]', () => {
    expect(britishSpelling('color')).toBe('colour')
    expect(britishSpelling('behavior')).toBe('behaviour')
    expect(britishSpelling('realize')).toBe('realise')
    expect(britishSpelling('analyze')).toBe('analyse')
    expect(britishSpelling('center')).toBe('centre')
    expect(britishSpelling('catalog')).toBe('catalogue')
    for (const word of ['or', 'for', 'floor', 'door', 'size', 'her', 'dog', 'cat'])
      expect(britishSpelling(word)).toBeNull()
    const { admit, skipped } = filterHeadwords(lemmas('color', 'colour', 'center', 'dialog'), {
      isEntry: (lemma) => lemma === 'dialogue',
      listed: () => true,
    })
    expect(admit).toEqual(['colour', 'center'])
    expect(skipped.variants).toEqual([
      { lemma: 'color', of: 'colour' },
      { lemma: 'dialog', of: 'dialogue' },
    ])
    expect(filterHeadwords(lemmas('center'), { isEntry: () => false, listed: () => true }).admit).toEqual(['center'])
  })
})
