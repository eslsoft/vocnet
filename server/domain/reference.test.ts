import { describe, expect, it } from 'vitest'
import {
  cefrjPos,
  frequencyKey,
  headwords,
  isWordForm,
  levelRank,
  mergeCefr,
  octanovePos,
  rankFrequencies,
} from './reference'

const cefrj = (rows: Array<[string, string, string]>) => ({
  id: 'cefrj',
  pos: cefrjPos,
  rows: rows.map(([headword, pos, level]) => ({ headword, pos, level })),
})
const octanove = (rows: Array<[string, string, string]>) => ({ ...cefrj(rows), id: 'octanove', pos: octanovePos })

describe('mergeCefr', () => {
  it('maps profile POS labels onto ours and drops numbers and infinitive "to" [spec: reference/cefr-pos]', () => {
    const { rows } = mergeCefr([
      cefrj([
        ['can', 'modal auxiliary', 'A1'],
        ['be', 'be-verb', 'A1'],
        ['do', 'do-verb', 'A1'],
        ['have', 'have-verb', 'A1'],
        ['run', 'verb', 'A1'],
        ['seven', 'number', 'A1'],
        ['to', 'infinitive-to', 'A1'],
        ['oh', ' interjection ', ' A2 '],
      ]),
      octanove([
        ['remonstrate', 'vern', 'C2'],
        ['batter', '', 'C1'],
      ]),
    ])
    expect(rows.map(({ lemma, pos, level }) => `${lemma}/${pos}/${level}`)).toEqual([
      'can/auxiliary/A1',
      'be/auxiliary/A1',
      'do/auxiliary/A1',
      'have/auxiliary/A1',
      'run/verb/A1',
      'oh/interjection/A2',
      'remonstrate/verb/C2',
    ])
  })

  it('keeps only the base lemma of be, do, and have and reports their inflected forms [spec: reference/cefr-inflected-forms]', () => {
    const { rows, inflections } = mergeCefr([
      cefrj([
        ['be', 'be-verb', 'A1'],
        ['is', 'be-verb', 'A1'],
        ["'s", 'be-verb', 'A1'],
        ['been', 'be-verb', 'A2'],
        ['being', 'be-verb', 'A1'],
        ['being', 'noun', 'A2'],
        ['do', 'do-verb', 'A1'],
        ['done', 'do-verb', 'A2'],
        ['done', 'adjective', 'B1'],
        ['have', 'have-verb', 'A1'],
        ['had', 'have-verb', 'A1'],
        ['will', 'modal auxiliary', 'A1'],
        ['have to', 'modal auxiliary', 'A1'],
        ['used to', 'modal auxiliary', 'B1'],
      ]),
    ])
    expect(rows.map(({ lemma, pos, level }) => `${lemma}/${pos}/${level}`)).toEqual([
      'be/auxiliary/A1',
      'being/noun/A2',
      'do/auxiliary/A1',
      'done/adjective/B1',
      'have/auxiliary/A1',
      'will/auxiliary/A1',
      'have to/auxiliary/A1',
      'used to/auxiliary/B1',
    ])
    expect(inflections).toEqual([
      { sourceId: 'cefrj', form: 'is', label: 'be-verb', level: 'A1' },
      { sourceId: 'cefrj', form: "'s", label: 'be-verb', level: 'A1' },
      { sourceId: 'cefrj', form: 'been', label: 'be-verb', level: 'A2' },
      { sourceId: 'cefrj', form: 'being', label: 'be-verb', level: 'A1' },
      { sourceId: 'cefrj', form: 'done', label: 'do-verb', level: 'A2' },
      { sourceId: 'cefrj', form: 'had', label: 'have-verb', level: 'A1' },
    ])
  })

  it('fails on a POS label or level the import does not know [spec: reference/cefr-pos]', () => {
    expect(() => mergeCefr([cefrj([['the', 'article', 'A1']])])).toThrow('cefrj: unknown POS "article".')
    expect(() => mergeCefr([cefrj([['the', 'determiner', 'D1']])])).toThrow()
  })

  it('splits spelling variants into lemmas of their own [spec: reference/cefr-pos]', () => {
    expect(headwords('a.m./A.M./am/AM')).toEqual(['a.m.', 'A.M.', 'am', 'AM'])
    expect(headwords(' grey / gray /')).toEqual(['grey', 'gray'])
    expect(mergeCefr([cefrj([['colour/color', 'noun', 'A1']])]).rows).toEqual([
      { lemma: 'colour', pos: 'noun', level: 'A1', sourceId: 'cefrj' },
      { lemma: 'color', pos: 'noun', level: 'A1', sourceId: 'cefrj' },
    ])
  })

  it('keeps the lowest level of a source and lets an earlier source win [spec: reference/cefr-precedence]', () => {
    const { rows } = mergeCefr([
      cefrj([
        ['bank', 'noun', 'A2'],
        ['bank', 'noun', 'A1'],
        ['bank', 'noun', 'B1'],
      ]),
      octanove([
        ['bank', 'noun', 'C1'],
        ['bank', 'verb', 'C2'],
        ['bank', 'verb', 'C1'],
        ['cast', 'noun', 'C2'],
        ['cast', 'noun', 'C1'],
      ]),
    ])
    expect(rows).toEqual([
      { lemma: 'bank', pos: 'noun', level: 'A1', sourceId: 'cefrj' },
      { lemma: 'bank', pos: 'verb', level: 'C1', sourceId: 'octanove' },
      { lemma: 'cast', pos: 'noun', level: 'C1', sourceId: 'octanove' },
    ])
  })
})

// Built from code points so the decomposed spelling survives formatting.
const decomposedCafe = `cafe${String.fromCodePoint(0x301)}`

describe('rankFrequencies', () => {
  it('keeps every single word form, ranked by Zipf with shared ranks for ties [spec: reference/frequency-rank]', () => {
    const rows = rankFrequencies([
      { form: 'the', zipf: 7.73 },
      { form: 'of', zipf: 7.4 },
      { form: 'and', zipf: 7.4 },
      { form: 'ice cream', zipf: 4.47 },
      { form: '00th', zipf: 3 },
      { form: '#', zipf: 3 },
      { form: 'info@', zipf: 3 },
      { form: "don't", zipf: 6.2 },
      { form: 'in', zipf: 7.4 },
      { form: decomposedCafe, zipf: 2.5 },
      { form: 'zyzzyva', zipf: 1.01 },
    ])
    expect(rows).toEqual([
      { word: 'the', zipf: 7.73, rank: 1 },
      { word: 'and', zipf: 7.4, rank: 2 },
      { word: 'in', zipf: 7.4, rank: 2 },
      { word: 'of', zipf: 7.4, rank: 2 },
      { word: "don't", zipf: 6.2, rank: 5 },
      { word: 'caf\u00e9', zipf: 2.5, rank: 6 },
      { word: 'zyzzyva', zipf: 1.01, rank: 7 },
    ])
  })

  it('fails on two forms with one key [spec: reference/frequency-rank]', () => {
    const forms = [
      { form: 'caf\u00e9', zipf: 2.5 },
      { form: decomposedCafe, zipf: 2.1 },
    ]
    expect(() => rankFrequencies(forms)).toThrow('Two frequency forms have the key "caf\u00e9".')
  })

  it('keys every capitalization of a lemma by its lowercase spelling [spec: reference/frequency-rank]', () => {
    expect(['May', 'may', 'MAY'].map(frequencyKey)).toEqual(['may', 'may', 'may'])
    expect(rankFrequencies([{ form: 'English', zipf: 5.5 }])).toEqual([{ word: 'english', zipf: 5.5, rank: 1 }])
  })

  it('accepts one token of letters, combining marks, apostrophes, and periods [spec: reference/frequency-rank]', () => {
    expect(['bank', 'a.m.', "o'clock", decomposedCafe].every(isWordForm)).toBe(true)
    const junk = ['ice cream', '3rd', '#', '', '.', "'", 'info@', 'cs:go', 'align:center', 'size_t', 'well-known']
    expect([...junk, `i${String.fromCodePoint(0xfe0f)}`].some(isWordForm)).toBe(false)
  })

  it('ranks levels in learning order [spec: work/claim-tiers]', () => {
    expect((['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const).map(levelRank)).toEqual([1, 2, 3, 4, 5, 6])
  })
})
