import type { ReviewMeta } from '@shared/catalog'
import type { EntryId, FactId, SenseId, TopicId } from '@shared/facts'
import { describe, expect, it } from 'vitest'
import type { StoredEntry, StoredSense, StoredSummary } from './catalog-view'
import { contentKeyOf } from './fact-kinds'
import {
  type EntryLinks,
  formMatches,
  inLanguage,
  publicViewRecord,
  readStored,
  shapeEntry,
  shapeSenseDetail,
  shapeSenseSummary,
  shapeSummary,
} from './public-view'

const review = (id: string): ReviewMeta => ({ fact_id: id as FactId, confidence: 0.9, verdict: 'pass' })
const entryId = 'e0000000-0000-4000-8000-000000000001' as EntryId

const storedSense = (id: string, topics: string[], translations: Record<string, string[]>): StoredSense => ({
  id: id as SenseId,
  gloss: `Gloss of ${id}.`,
  labels: [],
  rare: false,
  translations,
  grammar: { countability: 'countable', patterns: [], prepositions: [], review: review(`g-${id}`) },
  examples: [{ text: `An example of ${id}.`, review: review(`x-${id}`) }],
  collocations: [{ text: `river ${id}`, pattern: 'noun_noun', review: review(`c-${id}`) }],
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
  morphology: { parts: [{ form: 'bank', role: 'base' }], review: review('m1') },
  meanings: [
    {
      pos: 'noun',
      cefr: 'A2',
      pronunciations: [],
      forms: { plural: ['banks'] },
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
      forms: { past: ['banked'] },
      senses: [storedSense('s3', [], { zh: ['存'] })],
      review: { forms: { past: [review('f2')] } },
    },
  ],
  summary,
  review: { entry: review('e1'), sense_list: null },
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
    expect(record.forms).toEqual([
      { contentKey: contentKeyOf('form', { form: 'banks', type: 'plural' }), type: 'plural', pos: 'noun' },
      { contentKey: contentKeyOf('form', { form: 'banked', type: 'past' }), type: 'past', pos: 'verb' },
      { contentKey: contentKeyOf('form', { form: 'banque', type: 'variant' }), type: 'variant', pos: null },
    ])
    expect(record.taggedSenses).toEqual([
      {
        topicId: 'finance',
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
    expect(readStored<StoredEntry>(JSON.stringify(bank))).toEqual(bank)
  })
})

describe('public read variants', () => {
  it('reads one language by lookup, never another [spec: catalog/language]', () => {
    const values = { zh: 'a', 'zh-Hant': 'b', fr: 'c' }
    expect(inLanguage(values, 'zh')).toBe('a')
    expect(inLanguage(values, 'ZH-hant')).toBe('b')
    expect(inLanguage(values, 'zh-Hant-TW')).toBe('b')
    expect(inLanguage(values, 'zh-CN')).toBe('a')
    expect(inLanguage(values, 'ja')).toBeUndefined()
    expect(inLanguage({ 'zh-Hant': 'b' }, 'zh')).toBeUndefined()

    const translations = (lang: string | null) =>
      shapeEntry(bank, links, { lang, review: false }).meanings[0]?.senses.map((sense) => sense.translations)
    expect(translations('zh')).toEqual([['银行', '库'], []])
    expect(translations('zh-TW')).toEqual([['银行', '库'], []])
    expect(translations('ja')).toEqual([[], []])
    expect(translations('all')).toEqual([{ zh: ['银行', '库'], 'zh-Hant': ['銀行'], fr: ['banque'] }, {}])
    expect(translations(null)).toEqual([undefined, undefined])
    expect(Object.keys(shapeEntry(bank, links, none).meanings[0]?.senses[0] ?? {})).not.toContain('translations')

    const names = (lang: string | null) =>
      shapeEntry(bank, links, { lang, review: false }).meanings[0]?.senses[0]?.topics.map((topic) => topic.name)[0]
    expect(names('zh')).toEqual({ en: 'Topic finance', zh: '话题 finance' })
    expect(names('zh-CN')).toEqual({ en: 'Topic finance', 'zh-CN': '话题 finance' })
    expect(names('en')).toEqual({ en: 'Topic finance' })
    expect(names('ja')).toEqual({ en: 'Topic finance' })
    expect(names(null)).toEqual({ en: 'Topic finance' })
    expect(names('all')).toEqual({ en: 'Topic finance', zh: '话题 finance' })

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
    expect(reviewed.review).toEqual({ entry: review('e1'), sense_list: null })
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

  it('links each word formation part with a public entry of that spelling', () => {
    const parts = (publicParts: string[]) => shapeEntry(bank, { ...links, publicParts }, none).morphology?.parts
    expect(parts(['bank'])).toEqual([{ form: 'bank', role: 'base', lemma: 'bank' }])
    expect(parts([])).toEqual([{ form: 'bank', role: 'base' }])
    expect(shapeEntry({ ...bank, morphology: null }, links, none).morphology).toBeNull()
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
    expect(shapeSummary(summary, { lang: 'all', review: false }).translation).toEqual({ zh: '银行' })
    expect(shapeSummary({ ...summary, translations: {} }, { lang: 'all', review: false })).not.toHaveProperty(
      'translation',
    )
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
