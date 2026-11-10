import { describe, expect, it } from 'vitest'
import { fieldTier, SEARCH_TIERS, searchBody, searchTerms } from './search'

describe('search index text', () => {
  it('spells CJK runs out as characters and pairs and looks a query up by its pairs [spec: search/tokens]', () => {
    expect(searchBody('银行（金融机构）')).toBe(' 银 行 银行 （ 金 融 机 构 金融 融机 机构 ）')
    expect(searchBody('A bank: 银行.')).toBe('A bank:  银 行 银行 .')
    expect(searchBody('Plain words')).toBe('Plain words')
    expect(searchTerms('银行')).toEqual(['银行'])
    expect(searchTerms('银行家')).toEqual(['银行', '行家'])
    expect(searchTerms('钱')).toEqual(['钱'])
    expect(searchTerms('  River bank, river ')).toEqual(['River', 'bank', 'river'])
    expect(searchTerms('café 银行 deposit')).toEqual(['café', 'deposit', '银行'])
    expect(searchTerms('"*-')).toEqual([])
  })

  it('ranks the lemma before glosses, translations, and examples', () => {
    expect(SEARCH_TIERS).toEqual(['lemma', 'lemma', 'gloss', 'translation', 'example'])
    expect(fieldTier('gloss')).toBe(2)
    expect(fieldTier('example')).toBe(4)
  })
})
