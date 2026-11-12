import type { ReviewMeta } from '@shared/catalog'
import type { EntryId, FactId, SenseId, TopicId } from '@shared/facts'
import { describe, expect, it } from 'vitest'
import type { StoredEntry, StoredMeaning, StoredSense, StoredSummary } from './catalog-view'
import {
  type EntryLinks,
  formMatches,
  publicViewRecord,
  readStored,
  shapeEntry,
  shapeSenseDetail,
  shapeSenseSummary,
  shapeSummary,
  UNRANKED,
} from './public-view'

const review = (id: string): ReviewMeta => ({ fact_id: id as FactId, confidence: 0.9, verdict: 'pass' })
const entryId = 'e0000000-0000-4000-8000-000000000001' as EntryId

const storedSense = (id: string, topics: string[], translations: Record<string, string[]>): StoredSense => ({
  id: id as SenseId,
  gloss: `Gloss of ${id}.`,
  labels: [],
  region: null,
  rare: false,
  translations,
  grammar: { countability: 'countable', patterns: [], prepositions: [], review: review(`g-${id}`) },
  examples: [{ text: `An example of ${id}.`, translations: { zh: `${id} 的例句。` }, review: review(`x-${id}`) }],
  collocations: [
    { text: `river ${id}`, pattern: 'noun_noun', translations: { zh: `${id} 的搭配` }, review: review(`c-${id}`) },
  ],
  topics: topics.map((topic) => ({
    id: topic as TopicId,
    name: { en: `Topic ${topic}`, zh: `话题 ${topic}` },
    review: review(`t-${id}-${topic}`),
  })),
  relations: {
    synonyms: [{ lemma: 'shore', sense_id: 's9' as SenseId, gloss: 'Land along water.', review: review(`r-${id}`) }],
    antonyms: [],
    broader: [],
    narrower: [],
    part_of: [],
    parts: [],
  },
  review: {
    gloss: review(`s-${id}`),
    translations: Object.fromEntries(
      Object.entries(translations).map(([language, texts]) => [
        language,
        texts.map((_, at) => review(`tr-${language}-${at}`)),
      ]),
    ),
  },
})

const summary: StoredSummary = {
  lemma: 'bank',
  pos: ['noun', 'verb'],
  cefr: 'A2',
  gloss: 'Gloss of s1.',
  translations: { zh: '银行' },
}

const bank: StoredEntry = {
  id: entryId,
  lemma: 'bank',
  frequency: { zipf: 5.16, rank: 691 },
  pronunciations: [{ ipa: 'bæŋk', accent: 'us', review: review('p1') }],
  variants: [{ form: 'banque', review: review('v1') }],
  syllables: ['bank'],
  morphology: { parts: [{ form: 'bank', role: 'base' }], review: review('m1') },
  meanings: [
    {
      pos: 'noun',
      cefr: 'A2',
      pronunciations: [],
      forms: { plural: [{ form: 'banks', irregular: false }] },
      senses: [
        storedSense('s1', ['finance', 'places'], { zh: ['银行', '库'], 'zh-Hant': ['銀行'], fr: ['banque'] }),
        storedSense('s2', [], {}),
      ],
      review: { forms: { plural: [review('f1')] } },
    },
    {
      pos: 'verb',
      cefr: null,
      pronunciations: [{ ipa: 'bæŋk', accent: 'uk', strength: 'weak', review: review('p2') }],
      forms: { past: [{ form: 'banked', irregular: false }] },
      senses: [storedSense('s3', [], { zh: ['存'] })],
      review: { forms: { past: [review('f2')] } },
    },
  ],
  summary,
  phrases: ['bank on'],
  review: { inventory: review('e1'), syllables: review('y1'), phrases: review('h1') },
  forms: [
    { form: 'banks', type: 'plural', pos: 'noun' },
    { form: 'banked', type: 'past', pos: 'verb' },
    { form: 'bankest', type: 'superlative', pos: 'adverb' },
    { form: 'banque', type: 'variant', pos: null },
  ],
}

const links: EntryLinks = {
  phrases: [{ lemma: 'bank on', pos: ['verb'], cefr: null, gloss: 'To rely on.', translations: { zh: '指望' } }],
  family: [{ lemma: 'banker', pos: ['noun'], cefr: 'B2', gloss: 'One who banks.', translations: {} }],
  publicParts: ['bank'],
}

const none = { lang: null, review: false }

describe('public view records', () => {
  it('derives every row from the stored document [spec: public-view/document]', () => {
    const record = publicViewRecord(bank)
    expect(record.document).toBe(bank)
    expect(record.frequencyOrder).toBe(691)
    expect(record.meanings).toEqual([
      { pos: 'noun', cefr: 'A2' },
      { pos: 'verb', cefr: null },
    ])
    expect(record.forms).toEqual([
      { form: 'banks', type: 'plural', pos: 'noun' },
      { form: 'banked', type: 'past', pos: 'verb' },
      { form: 'bankest', type: 'superlative', pos: 'adverb' },
      { form: 'banque', type: 'variant', pos: null },
    ])
    expect(publicViewRecord({ ...bank, forms: [{ form: ' bank  up ', type: 'variant', pos: null }] }).forms).toEqual([
      { form: 'bank up', type: 'variant', pos: null },
    ])
    expect(record.searchTexts).toEqual([
      { field: 'gloss', scope: 'en', body: 'Gloss of s1.' },
      { field: 'translation', scope: 'zh', body: ' 银 行 银行 ' },
      { field: 'translation', scope: 'zh', body: ' 库 ' },
      { field: 'translation', scope: 'zh-Hant', body: ' 銀 行 銀行 ' },
      { field: 'translation', scope: 'fr', body: 'banque' },
      { field: 'example', scope: 'en', body: 'An example of s1.' },
      { field: 'gloss', scope: 'en', body: 'Gloss of s2.' },
      { field: 'example', scope: 'en', body: 'An example of s2.' },
      { field: 'gloss', scope: 'en', body: 'Gloss of s3.' },
      { field: 'translation', scope: 'zh', body: ' 存 ' },
      { field: 'example', scope: 'en', body: 'An example of s3.' },
    ])
    const twice = storedSense('s1', [], { zh: ['银行', '银行'] })
    expect(
      publicViewRecord({ ...bank, meanings: [{ ...(bank.meanings[0] as StoredMeaning), senses: [twice, twice] }] })
        .searchTexts,
    ).toHaveLength(3)
    expect(record.taggedSenses).toEqual([
      {
        topicId: 'finance',
        levelOrder: 2,
        rare: false,
        summary: {
          lemma: 'bank',
          sense_id: 's1',
          pos: 'noun',
          cefr: 'A2',
          gloss: 'Gloss of s1.',
          translations: { zh: '银行', 'zh-Hant': '銀行', fr: 'banque' },
        },
      },
      expect.objectContaining({ topicId: 'places' }),
    ])
    expect(record.phraseWords).toEqual([])
    expect(record.morphemes).toEqual([{ form: 'bank', role: 'base' }])

    const phrase = publicViewRecord({
      ...bank,
      lemma: 'bank on bank',
      morphology: {
        parts: [
          { form: 'on', role: 'base' },
          { form: 'on', role: 'base' },
        ],
        review: review('m2'),
      },
    })
    expect(phrase.phraseWords).toEqual(['bank', 'on'])
    expect(phrase.morphemes).toEqual([{ form: 'on', role: 'base' }])
    expect(publicViewRecord({ ...bank, morphology: null }).morphemes).toEqual([])
    const unranked = publicViewRecord({
      ...bank,
      frequency: null,
      meanings: [{ ...(bank.meanings[0] as StoredMeaning), cefr: null }],
    })
    expect(unranked.frequencyOrder).toBe(UNRANKED)
    expect(unranked.taggedSenses[0]?.levelOrder).toBe(7)
    expect(readStored<StoredEntry>(JSON.stringify(bank))).toEqual(bank)
  })
})

describe('public read variants', () => {
  it('reads exactly the served language, never another [spec: catalog/language]', () => {
    const translations = (lang: string | null) =>
      shapeEntry(bank, links, { lang, review: false }).meanings[0]?.senses.map((sense) => sense.translations)
    expect(translations('zh')).toEqual([['银行', '库'], []])
    expect(translations('ja')).toEqual([[], []])
    expect(translations('all')).toEqual([{ zh: ['银行', '库'], 'zh-Hant': ['銀行'], fr: ['banque'] }, {}])
    expect(translations(null)).toEqual([undefined, undefined])
    expect(Object.keys(shapeEntry(bank, links, none).meanings[0]?.senses[0] ?? {})).not.toContain('translations')

    const names = (lang: string | null) =>
      shapeEntry(bank, links, { lang, review: false }).meanings[0]?.senses[0]?.topics.map((topic) => topic.name)[0]
    expect(names('zh')).toEqual({ en: 'Topic finance', zh: '话题 finance' })
    expect(names('ja')).toEqual({ en: 'Topic finance' })
    expect(names(null)).toEqual({ en: 'Topic finance' })
    expect(names('all')).toEqual({ en: 'Topic finance', zh: '话题 finance' })
    // Summaries keep one shape: with all they carry no translation.
    expect(shapeEntry(bank, links, { lang: 'all', review: false }).phrases[0]).not.toHaveProperty('translation')

    const entry = shapeEntry(bank, links, { lang: 'zh', review: false })
    expect(entry.lang).toBe('zh')
    expect(entry.phrases).toEqual([
      { lemma: 'bank on', pos: ['verb'], cefr: null, gloss: 'To rely on.', translation: '指望' },
    ])
    expect(entry.morphology?.family).toEqual([{ lemma: 'banker', pos: ['noun'], cefr: 'B2', gloss: 'One who banks.' }])
  })

  it('shows review metadata only when asked for [spec: catalog/review-metadata]', () => {
    const plain = JSON.stringify(shapeEntry(bank, links, { lang: 'all', review: false }))
    expect(plain).not.toContain('"review"')
    expect(plain).not.toContain('fact_id')

    const reviewed = shapeEntry(bank, links, { lang: 'zh', review: true })
    expect(reviewed.review).toEqual({ inventory: review('e1'), syllables: review('y1'), phrases: review('h1') })
    expect(reviewed.pronunciations[0]?.review).toEqual(review('p1'))
    expect(reviewed.variants[0]?.review).toEqual(review('v1'))
    expect(reviewed.morphology?.review).toEqual(review('m1'))
    expect(reviewed.meanings[0]?.review).toEqual({ forms: { plural: [review('f1')] } })
    const [first] = reviewed.meanings[0]?.senses ?? []
    expect(first?.review).toEqual({ gloss: review('s-s1'), translations: [review('tr-zh-0'), review('tr-zh-1')] })
    expect(first?.grammar?.review).toEqual(review('g-s1'))
    expect(first?.examples[0]?.review).toEqual(review('x-s1'))
    expect(first?.collocations[0]?.review).toEqual(review('c-s1'))
    expect(first?.topics[0]?.review).toEqual(review('t-s1-finance'))
    expect(first?.relations.synonyms[0]?.review).toEqual(review('r-s1'))
    expect(shapeEntry(bank, links, { lang: null, review: true }).meanings[0]?.senses[0]?.review).toEqual({
      gloss: review('s-s1'),
    })
  })

  it('shows syllables, form objects, and example translations in the read language [spec: catalog/new-fields]', () => {
    const exampleOf = (lang: string | null) =>
      shapeEntry(bank, links, { lang, review: false }).meanings[0]?.senses[0]?.examples[0]
    expect(exampleOf('zh')).toEqual({ text: 'An example of s1.', translation: 's1 的例句。' })
    expect(exampleOf('all')).toEqual({ text: 'An example of s1.', translation: { zh: 's1 的例句。' } })
    expect(exampleOf(null)).toEqual({ text: 'An example of s1.' })
    const entry = shapeEntry(bank, links, { lang: null, review: false })
    expect(entry.syllables).toEqual(['bank'])
    expect(entry.meanings[0]?.forms).toEqual({ plural: [{ form: 'banks', irregular: false }] })
  })

  it('shows a collocation translation in the read language, like an example [spec: catalog/new-fields]', () => {
    const collocationOf = (lang: string | null) =>
      shapeEntry(bank, links, { lang, review: false }).meanings[0]?.senses[0]?.collocations[0]
    expect(collocationOf('zh')).toEqual({ text: 'river s1', pattern: 'noun_noun', translation: 's1 的搭配' })
    expect(collocationOf('all')).toEqual({ text: 'river s1', pattern: 'noun_noun', translation: { zh: 's1 的搭配' } })
    expect(collocationOf(null)).toEqual({ text: 'river s1', pattern: 'noun_noun' })
  })

  it('links each word formation part with a public entry of that spelling', () => {
    const parts = (publicParts: string[]) => shapeEntry(bank, { ...links, publicParts }, none).morphology?.parts
    expect(parts(['bank'])).toEqual([{ form: 'bank', role: 'base', lemma: 'bank' }])
    expect(parts([])).toEqual([{ form: 'bank', role: 'base' }])
    expect(shapeEntry({ ...bank, morphology: null }, links, none).morphology).toBeNull()
  })

  it('shows what a shortened word shortens [spec: catalog/usage-facts]', () => {
    const review = bank.morphology?.review
    if (!review) throw new Error('The fixture has no morphology.')
    const shortened = { type: 'abbreviation' as const, of: 'mistress' }
    const mrs = { ...bank, morphology: { parts: [{ form: 'Mrs', role: 'base' as const }], shortened, review } }
    expect(shapeEntry(mrs, links, none).morphology).toEqual({
      parts: [{ form: 'Mrs', role: 'base' }],
      shortened,
      family: [expect.objectContaining({ lemma: 'banker' })],
    })
    expect(shapeEntry(bank, links, none).morphology).not.toHaveProperty('shortened')
  })

  it('reads a base by the entry it names, so the words built on one entry find each other [spec: public-view/family-lemma]', () => {
    const review = bank.morphology?.review
    if (!review) throw new Error('The fixture has no morphology.')
    const student = {
      ...bank,
      morphology: {
        parts: [
          { form: 'stud', role: 'base' as const, lemma: 'study' },
          { form: '-ent', role: 'suffix' as const },
        ],
        review,
      },
    }
    expect(publicViewRecord(student).morphemes).toEqual([
      { form: 'study', role: 'base' },
      { form: '-ent', role: 'suffix' },
    ])
    const parts = (publicParts: string[]) => shapeEntry(student, { ...links, publicParts }, none).morphology?.parts
    expect(parts(['study'])).toEqual([
      { form: 'stud', role: 'base', lemma: 'study' },
      { form: '-ent', role: 'suffix' },
    ])
    expect(parts([])).toEqual([
      { form: 'stud', role: 'base' },
      { form: '-ent', role: 'suffix' },
    ])
  })

  it('cuts one sense out with its part of speech and entry summary', () => {
    const detail = shapeSenseDetail(bank, 's3' as SenseId, { lang: 'zh', review: false })
    expect(detail).toMatchObject({
      lang: 'zh',
      id: 's3',
      pos: 'verb',
      translations: ['存'],
      entry: { lemma: 'bank', pos: ['noun', 'verb'], cefr: 'A2', gloss: 'Gloss of s1.', translation: '银行' },
    })
    expect(shapeSenseDetail(bank, 's8' as SenseId, none)).toBeNull()
  })

  it('summarizes entries, senses, and form matches in the requested language [spec: catalog/summary]', () => {
    expect(shapeSummary(summary, none)).toEqual({
      lemma: 'bank',
      pos: ['noun', 'verb'],
      cefr: 'A2',
      gloss: 'Gloss of s1.',
    })
    expect(shapeSummary(summary, { lang: 'zh', review: true }).translation).toBe('银行')
    expect(shapeSummary(summary, { lang: 'all', review: false })).not.toHaveProperty('translation')
    expect(shapeSummary(summary, { lang: 'fr', review: false })).not.toHaveProperty('translation')

    const sense = {
      lemma: 'bank',
      sense_id: 's1' as SenseId,
      pos: 'noun' as const,
      cefr: null,
      gloss: 'Land.',
      translations: { zh: '岸' },
    }
    expect(shapeSenseSummary(sense, { lang: 'zh', review: false })).toEqual({
      lemma: 'bank',
      sense_id: 's1',
      pos: 'noun',
      cefr: null,
      gloss: 'Land.',
      translation: '岸',
    })
    expect(shapeSenseSummary(sense, none)).not.toHaveProperty('translation')

    const records = { ...summary, lemma: 'record' }
    expect(
      formMatches(
        [
          { summary: records, type: 'plural', pos: 'noun' },
          { summary: records, type: 'third_person_singular', pos: 'verb' },
          { summary, type: 'variant', pos: null },
        ],
        none,
      ),
    ).toEqual([
      {
        ...shapeSummary(records, none),
        matches: [
          { type: 'plural', pos: 'noun' },
          { type: 'third_person_singular', pos: 'verb' },
        ],
      },
      { ...shapeSummary(summary, none), matches: [{ type: 'variant' }] },
    ])
  })
})
