import type {
  EntryOverview,
  FormMatch,
  PublicEntry,
  PublicPhrases,
  PublicPicture,
  PublicSense,
  PublicSenseDetail,
  PublicSentence,
  Relations,
  ReviewMeta,
  SenseSummary,
  WordSummary,
} from '@shared/catalog'
import type { FormType, MorphemeRole, Pos, RelationDomain, SenseId, TopicId } from '@shared/facts'
import { type MediaId, mediaUrl } from '@shared/media'
import { type CefrLevel, cefrLevelSchema } from '@shared/reference'
import {
  type ByLanguage,
  firstOfEach,
  type StoredEntry,
  type StoredPicture,
  type StoredSense,
  type StoredSenseSummary,
  type StoredSummary,
} from './catalog-view'
import { levelRank } from './reference'
import { type SearchField, searchBody } from './search'
import { normalizeTerm } from './term'
import type { TopicNode } from './topics'

// The public view stores each entry's public document, built by the same projection that defines
// visibility, plus the lookup rows the other public reads need. Everything here derives from the
// document, so the view can never say more than the projection does. A read cuts the requested
// language and review variant out of the stored document and joins what other entries supply.

/** The rows the public view stores for one entry. */
export interface PublicViewRecord {
  document: StoredEntry
  /** Where the entry sorts by frequency: by its frequency rank, after every ranked entry without one. */
  frequencyOrder: number
  /** One per meaning, so lists filter by part of speech and level. */
  meanings: Array<{ pos: Pos; cefr: CefrLevel | null }>
  /** One per published form, shown or not, by its spelling, with the part of speech it is shown under. */
  forms: Array<{ form: string; type: FormType; pos: Pos | null }>
  /** One per published topic tag of a public sense, with where it sorts by level. */
  /** `rare`: the sense is in the extra senses of the entry's sense list, so an entry listing by topic leaves it out. */
  taggedSenses: Array<{ topicId: TopicId; summary: StoredSenseSummary; levelOrder: number; rare: boolean }>
  /** One per broader term a public sense shows, with the sense's summary: the members walk of a category. */
  hypernyms: Array<{ broaderSenseId: SenseId; domain: RelationDomain | null; summary: StoredSenseSummary }>
  /** One per distinct gloss, translation, and example of a public sense, as the search index stores it. */
  searchTexts: Array<{ field: SearchField; scope: string; body: string }>
  /** The parts of the entry's word formation, so entries sharing a base or root find each other. */
  morphemes: Array<{ form: string; role: MorphemeRole }>
}

/** What a read joins from other entries' views into an entry document. */
export interface EntryLinks {
  /** Summaries of the public phrase entries the headword's published list names. */
  phrases: StoredSummary[]
  /** Summaries of the other public entries sharing a base or root, in lemma order. */
  family: StoredSummary[]
  /** The morphology part forms that are the lemma of a public entry. */
  publicParts: string[]
}

/**
 * Each leaf topic's category as the taxonomy has it now. A read joins it to the topic tags of a
 * sense, so a tag shows its category without the document storing it.
 */
export type TopicCategories = ReadonlyMap<TopicId, { id: TopicId; name: ByLanguage<string> }>

export function topicCategories(nodes: readonly TopicNode[]): TopicCategories {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const categories = new Map<TopicId, { id: TopicId; name: ByLanguage<string> }>()
  for (const node of nodes) {
    const parent = node.parentId === null ? undefined : byId.get(node.parentId)
    if (parent) categories.set(node.id, { id: parent.id, name: { en: parent.nameEn, zh: parent.nameZh } })
  }
  return categories
}

/** The language and review variant a read asks for. */
export interface ReadVariant {
  /** A served language tag, `all` for every language, or null for none. */
  lang: string | null
  review: boolean
  /** A specialist taxonomy whose hypernyms the relations show beside the everyday layer; absent shows the everyday layer alone. */
  domain?: RelationDomain
}

/** A related sense shows in the everyday layer, or in the domain layer the read asks for. */
const inLayer = (item: { domain?: RelationDomain }, variant: ReadVariant) =>
  item.domain === undefined || item.domain === variant.domain

/** The roles a word family shares: the parts that carry the meaning. */
export const STEM_ROLES: readonly MorphemeRole[] = ['base', 'root']

/**
 * The word a morphology part stands for: the entry a base names by its lemma, else the part as
 * spelled. Entries built on the same entry share it, so they find each other as a family.
 */
export const partWord = (part: { form: string; lemma?: string }) => part.lemma ?? part.form

/** The sort order of entries without a frequency rank: after every ranked one. */
export const UNRANKED = 2 ** 31 - 1

/** The sort order of a CEFR level, lowest first, with no level after every level. */
export const levelOrder = (cefr: CefrLevel | null) => (cefr ? levelRank(cefr) : cefrLevelSchema.options.length + 1)

/** The scope of English text in the search index; a translation's is its language tag. */
export const ENGLISH_SCOPE = 'en'

function searchTextsOf(document: StoredEntry): PublicViewRecord['searchTexts'] {
  const texts = new Map<string, PublicViewRecord['searchTexts'][number]>()
  const add = (field: SearchField, scope: string, text: string) => {
    const body = searchBody(text)
    texts.set(JSON.stringify([field, scope, body]), { field, scope, body })
  }
  for (const sense of document.meanings.flatMap((meaning) => meaning.senses)) {
    add('gloss', ENGLISH_SCOPE, sense.gloss)
    for (const [language, translations] of Object.entries(sense.translations)) {
      for (const text of translations) add('translation', language, text)
    }
    for (const example of sense.examples) add('example', ENGLISH_SCOPE, example.text)
  }
  return [...texts.values()]
}

const senseSummaryOf = (
  document: StoredEntry,
  meaning: StoredEntry['meanings'][number],
  sense: StoredSense,
): StoredSenseSummary => ({
  lemma: document.lemma,
  sense_id: sense.id,
  pos: meaning.pos,
  cefr: meaning.cefr,
  cefr_source: meaning.cefr === null ? null : document.cefr_source,
  gloss: sense.gloss,
  translations: firstOfEach(sense.translations),
  image_id: sense.image?.image_id ?? null,
})

export function publicViewRecord(document: StoredEntry): PublicViewRecord {
  const parts = document.morphology?.parts ?? []
  return {
    document,
    frequencyOrder: document.frequency?.rank ?? UNRANKED,
    meanings: document.meanings.map(({ pos, cefr }) => ({ pos, cefr })),
    forms: document.forms.map(({ form, type, pos }) => ({ form: normalizeTerm(form), type, pos })),
    taggedSenses: document.meanings.flatMap((meaning) =>
      meaning.senses.flatMap((sense) =>
        sense.topics.map((topic) => ({
          topicId: topic.id,
          levelOrder: levelOrder(meaning.cefr),
          rare: sense.rare,
          summary: senseSummaryOf(document, meaning, sense),
        })),
      ),
    ),
    hypernyms: document.meanings.flatMap((meaning) =>
      meaning.senses.flatMap((sense) =>
        sense.relations.broader.map((broader) => ({
          broaderSenseId: broader.sense_id,
          domain: broader.domain ?? null,
          summary: senseSummaryOf(document, meaning, sense),
        })),
      ),
    ),
    morphemes: [
      ...new Map(
        parts.map((part) => [`${part.role}:${partWord(part)}`, { form: partWord(part), role: part.role }]),
      ).values(),
    ],
    searchTexts: searchTextsOf(document),
  }
}

/** Stored JSON is what the view wrote from these types, so it is read back as is. */
export const readStored = <T extends StoredEntry | StoredSummary | StoredSenseSummary>(json: string): T =>
  JSON.parse(json) as T

// The variant's language is already a served tag (server/domain/language.ts), so a read takes the
// values stored under exactly that tag and never another.

function translationsIn<T>(values: ByLanguage<T[]>, lang: string | null): T[] | ByLanguage<T[]> | undefined {
  if (lang === null) return undefined
  if (lang === 'all') return values
  return values[lang] ?? []
}

/** An example shows its translation in the read's language, every one with `all`, and none without a language. */
function exampleTranslationIn(
  values: ByLanguage<string>,
  lang: string | null,
): string | ByLanguage<string> | undefined {
  if (lang === null) return undefined
  if (lang === 'all') return values
  return values[lang]
}

/** A summary shows one translation in the read's language; with `all` or no language it shows none. */
const translationIn = (values: ByLanguage<string>, lang: string | null): string | undefined =>
  lang === null || lang === 'all' ? undefined : values[lang]

/** A list shows every translation in the read's one language; with `all` or no language it shows none. */
const listTranslationsIn = (values: ByLanguage<string[]>, lang: string | null): string[] | undefined =>
  lang === null || lang === 'all' ? undefined : (values[lang] ?? [])

function nameIn(names: ByLanguage<string>, lang: string | null): ByLanguage<string> {
  if (lang === 'all') return names
  const { en } = names
  const local = lang === null ? undefined : names[lang]
  return lang === null || local === undefined ? { en } : { en, [lang]: local }
}

/** The review field of a claim, present only when the read asks for it. */
const reviewed = (meta: ReviewMeta | null, variant: ReadVariant) => (variant.review && meta ? { review: meta } : {})

function withReview<T extends { review?: ReviewMeta }>(item: T, variant: ReadVariant): T {
  const { review, ...rest } = item
  return { ...(rest as T), ...reviewed(review ?? null, variant) }
}

/** The URL of an optional stored picture id under the media base the read is configured with. */
const imageUrlOf = (media: string, imageId: MediaId | null) => (imageId === null ? null : mediaUrl(media, imageId))

/** A stored picture as a read shows it: its URL under the media base, in place of the id. */
function shapePicture({ image_id, ...picture }: StoredPicture, media: string, variant: ReadVariant): PublicPicture {
  return withReview({ ...picture, url: mediaUrl(media, image_id) }, variant)
}

export function shapeSummary(summary: StoredSummary, media: string, variant: ReadVariant): WordSummary {
  const translation = translationIn(summary.translations, variant.lang)
  return {
    lemma: summary.lemma,
    pos: summary.pos,
    cefr: summary.cefr,
    cefr_source: summary.cefr_source,
    gloss: summary.gloss,
    ...(translation === undefined ? {} : { translation }),
    image_url: imageUrlOf(media, summary.image_id),
  }
}

export function shapeSenseSummary(summary: StoredSenseSummary, media: string, variant: ReadVariant): SenseSummary {
  const translation = translationIn(summary.translations, variant.lang)
  return {
    lemma: summary.lemma,
    sense_id: summary.sense_id,
    pos: summary.pos,
    cefr: summary.cefr,
    cefr_source: summary.cefr_source,
    gloss: summary.gloss,
    ...(translation === undefined ? {} : { translation }),
    image_url: imageUrlOf(media, summary.image_id),
  }
}

/** The category of a topic tag. A tag whose topic the taxonomy lacks is broken data, not a tag to show bare. */
function categoryOf(topicId: TopicId, categories: TopicCategories, lang: string | null) {
  const category = categories.get(topicId)
  if (!category) throw new Error(`Topic ${topicId} is not a leaf of the taxonomy.`)
  return { id: category.id, name: nameIn(category.name, lang) }
}

function shapeSense(sense: StoredSense, media: string, variant: ReadVariant, categories: TopicCategories): PublicSense {
  const translations = translationsIn(sense.translations, variant.lang)
  const translationReviews = translationsIn(sense.review.translations, variant.lang)
  const relations = Object.fromEntries(
    Object.entries(sense.relations).map(([group, related]) => [
      group,
      related.filter((item) => inLayer(item, variant)).map((item) => withReview(item, variant)),
    ]),
  ) as Relations
  return {
    id: sense.id,
    gloss: sense.gloss,
    labels: sense.labels,
    region: sense.region,
    rare: sense.rare,
    ...(translations === undefined ? {} : { translations }),
    grammar: sense.grammar && withReview(sense.grammar, variant),
    examples: sense.examples.map(({ translations, ...item }) => {
      const translation = exampleTranslationIn(translations, variant.lang)
      return withReview({ ...item, ...(translation === undefined ? {} : { translation }) }, variant)
    }),
    collocations: sense.collocations.map(({ translations, ...item }) => {
      const translation = exampleTranslationIn(translations, variant.lang)
      return withReview({ ...item, ...(translation === undefined ? {} : { translation }) }, variant)
    }),
    topics: sense.topics.map((topic) => ({
      id: topic.id,
      name: nameIn(topic.name, variant.lang),
      category: categoryOf(topic.id, categories, variant.lang),
      ...reviewed(topic.review, variant),
    })),
    image: sense.image && shapePicture(sense.image, media, variant),
    relations,
    ...(variant.review
      ? {
          review: {
            gloss: sense.review.gloss,
            ...(translationReviews === undefined ? {} : { translations: translationReviews }),
          },
        }
      : {}),
  }
}

/**
 * The headword's phrases as a read shows them: each public phrase entry in list order, under the
 * sense it is filed under, else by its type; then the sayings.
 */
function shapePhrases(
  document: StoredEntry,
  summaries: readonly StoredSummary[],
  media: string,
  variant: ReadVariant,
): PublicPhrases {
  const byLemma = new Map(summaries.map((summary) => [summary.lemma, summary]))
  const listed = document.phrases.flatMap((phrase) => {
    const summary = byLemma.get(phrase.lemma)
    return summary ? [{ ...phrase, summary: shapeSummary(summary, media, variant) }] : []
  })
  const senseOrder = document.meanings.flatMap((meaning) => meaning.senses.map((sense) => sense.id))
  const unfiled = listed.filter((phrase) => phrase.sense_id === null || !senseOrder.includes(phrase.sense_id))
  const ofType = (...types: string[]) =>
    unfiled.filter((phrase) => types.includes(phrase.type)).map((phrase) => phrase.summary)
  return {
    by_sense: senseOrder.flatMap((senseId) => {
      const phrases = listed.filter((phrase) => phrase.sense_id === senseId).map((phrase) => phrase.summary)
      return phrases.length > 0 ? [{ sense_id: senseId, phrases }] : []
    }),
    phrasal_verbs: ofType('phrasal_verb'),
    idioms: ofType('idiom', 'fixed_phrase'),
    compounds: ofType('compound'),
    sayings: document.sayings.map(({ translations, ...saying }) => {
      const translation = exampleTranslationIn(translations, variant.lang)
      return { ...saying, ...(translation === undefined ? {} : { translation }) }
    }),
  }
}

/** The entry document as a read asks for it, with what other entries supply joined in. */
export function shapeEntry(
  document: StoredEntry,
  links: EntryLinks,
  media: string,
  variant: ReadVariant,
  categories: TopicCategories,
): PublicEntry {
  const publicParts = new Set(links.publicParts)
  const summaries = (items: StoredSummary[]) => items.map((item) => shapeSummary(item, media, variant))
  return {
    lang: variant.lang,
    id: document.id,
    lemma: document.lemma,
    frequency: document.frequency,
    pronunciations: document.pronunciations.map((item) => withReview(item, variant)),
    variants: document.variants.map((item) => withReview(item, variant)),
    syllables: document.syllables,
    cefr: document.cefr,
    cefr_source: document.cefr_source,
    morphology: document.morphology && {
      parts: document.morphology.parts.map(({ lemma, ...part }) => ({
        ...part,
        ...(publicParts.has(partWord({ lemma, ...part })) ? { lemma: partWord({ lemma, ...part }) } : {}),
      })),
      ...(document.morphology.shortened ? { shortened: document.morphology.shortened } : {}),
      family: summaries(links.family),
      ...reviewed(document.morphology.review, variant),
    },
    image: document.image && { ...shapePicture(document.image, media, variant), sense_id: document.image.sense_id },
    meanings: document.meanings.map((meaning) => ({
      pos: meaning.pos,
      cefr: meaning.cefr,
      productive_use: meaning.productive_use,
      skills: meaning.skills,
      pronunciations: meaning.pronunciations.map((item) => withReview(item, variant)),
      forms: meaning.forms,
      senses: meaning.senses.map((sense) => shapeSense(sense, media, variant, categories)),
      ...(variant.review ? { review: meaning.review } : {}),
    })),
    phrase_type: document.phrase_type,
    phrases: shapePhrases(document, links.phrases, media, variant),
    ...(variant.review ? { review: document.review } : {}),
  }
}

/** One sense of the document with its part of speech and its entry's summary; null when it has no such sense. */
export function shapeSenseDetail(
  document: StoredEntry,
  senseId: SenseId,
  media: string,
  variant: ReadVariant,
  categories: TopicCategories,
): PublicSenseDetail | null {
  for (const meaning of document.meanings) {
    const sense = meaning.senses.find((candidate) => candidate.id === senseId)
    if (sense) {
      return {
        lang: variant.lang,
        ...shapeSense(sense, media, variant, categories),
        pos: meaning.pos,
        entry: shapeSummary(document.summary, media, variant),
      }
    }
  }
  return null
}

/**
 * The entry as a word card shows it: its pronunciations and, per part of speech, how many senses
 * it has and the first `senses` of them with their translations. A list read, so one language.
 */
export function shapeOverview(document: StoredEntry, senses: number, variant: ReadVariant): EntryOverview {
  const bare = ({ ipa, accent, strength }: StoredEntry['pronunciations'][number]) => ({
    ipa,
    accent,
    ...(strength === undefined ? {} : { strength }),
  })
  return {
    id: document.id,
    lemma: document.lemma,
    cefr: document.summary.cefr,
    cefr_source: document.summary.cefr_source,
    frequency: document.frequency,
    pronunciations: document.pronunciations.map(bare),
    meanings: document.meanings.map((meaning) => ({
      pos: meaning.pos,
      cefr: meaning.cefr,
      pronunciations: meaning.pronunciations.map(bare),
      sense_count: meaning.senses.length,
      senses: meaning.senses.slice(0, senses).map((sense) => {
        const translations = listTranslationsIn(sense.translations, variant.lang)
        return {
          id: sense.id,
          gloss: sense.gloss,
          rare: sense.rare,
          ...(translations === undefined ? {} : { translations }),
        }
      }),
    })),
  }
}

/** The entries a form lookup found, one item per entry with every form of it that matched, in row order. */
export function formMatches(
  rows: ReadonlyArray<{ summary: StoredSummary; type: FormType; pos: Pos | null }>,
  media: string,
  variant: ReadVariant,
): FormMatch[] {
  const byLemma = new Map<string, FormMatch>()
  for (const row of rows) {
    const match = byLemma.get(row.summary.lemma) ?? { ...shapeSummary(row.summary, media, variant), matches: [] }
    match.matches.push({ type: row.type, ...(row.pos ? { pos: row.pos } : {}) })
    byLemma.set(row.summary.lemma, match)
  }
  return [...byLemma.values()]
}

/** What a sentence read joins: the sentence, its published meaning and translations, and where it shows. */
export interface SentenceRecord {
  id: PublicSentence['id']
  text: string
  source: string | null
  meaning: string | null
  translations: ByLanguage<string>
  examplesOf: Array<{ lemma: string; sense_id: SenseId }>
  sayingOf: string[]
}

/** A public sentence in the read's language. */
export function shapeSentence(record: SentenceRecord, variant: ReadVariant): PublicSentence {
  const translation = exampleTranslationIn(record.translations, variant.lang)
  return {
    lang: variant.lang,
    id: record.id,
    text: record.text,
    source: record.source,
    meaning: record.meaning,
    ...(translation === undefined ? {} : { translation }),
    examples_of: record.examplesOf,
    saying_of: record.sayingOf,
  }
}
