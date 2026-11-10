import type {
  FormMatch,
  PublicEntry,
  PublicSense,
  PublicSenseDetail,
  Relations,
  ReviewMeta,
  SenseSummary,
  WordSummary,
} from '@shared/catalog'
import type { FormType, MorphemeRole, Pos, SenseId, TopicId } from '@shared/facts'
import { type CefrLevel, cefrLevelSchema } from '@shared/reference'
import {
  type ByLanguage,
  firstOfEach,
  type StoredEntry,
  type StoredSense,
  type StoredSenseSummary,
  type StoredSummary,
} from './catalog-view'
import { levelRank } from './reference'
import { type SearchField, searchBody } from './search'
import { isMultiword, normalizeTerm } from './term'

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
  taggedSenses: Array<{ topicId: TopicId; summary: StoredSenseSummary; levelOrder: number }>
  /** One per distinct gloss, translation, and example of a public sense, as the search index stores it. */
  searchTexts: Array<{ field: SearchField; scope: string; body: string }>
  /** The words of a multiword lemma, so each word's entry finds it as a phrase. */
  phraseWords: string[]
  /** The parts of the entry's word formation, so entries sharing a base or root find each other. */
  morphemes: Array<{ form: string; role: MorphemeRole }>
}

/** What a read joins from other entries' views into an entry document. */
export interface EntryLinks {
  /** Summaries of the public multiword entries that have the lemma as a word, in lemma order. */
  phrases: StoredSummary[]
  /** Summaries of the other public entries sharing a base or root, in lemma order. */
  family: StoredSummary[]
  /** The morphology part forms that are the lemma of a public entry. */
  publicParts: string[]
}

/** The language and review variant a read asks for. */
export interface ReadVariant {
  /** A served language tag, `all` for every language, or null for none. */
  lang: string | null
  review: boolean
}

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
          summary: {
            lemma: document.lemma,
            sense_id: sense.id,
            pos: meaning.pos,
            cefr: meaning.cefr,
            gloss: sense.gloss,
            translations: firstOfEach(sense.translations),
          },
        })),
      ),
    ),
    phraseWords: isMultiword(document.lemma) ? [...new Set(document.lemma.split(' '))] : [],
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

export function shapeSummary(summary: StoredSummary, variant: ReadVariant): WordSummary {
  const translation = translationIn(summary.translations, variant.lang)
  return {
    lemma: summary.lemma,
    pos: summary.pos,
    cefr: summary.cefr,
    gloss: summary.gloss,
    ...(translation === undefined ? {} : { translation }),
  }
}

export function shapeSenseSummary(summary: StoredSenseSummary, variant: ReadVariant): SenseSummary {
  const translation = translationIn(summary.translations, variant.lang)
  return {
    lemma: summary.lemma,
    sense_id: summary.sense_id,
    pos: summary.pos,
    cefr: summary.cefr,
    gloss: summary.gloss,
    ...(translation === undefined ? {} : { translation }),
  }
}

function shapeSense(sense: StoredSense, variant: ReadVariant): PublicSense {
  const translations = translationsIn(sense.translations, variant.lang)
  const translationReviews = translationsIn(sense.review.translations, variant.lang)
  const relations = Object.fromEntries(
    Object.entries(sense.relations).map(([group, related]) => [
      group,
      related.map((item) => withReview(item, variant)),
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
    collocations: sense.collocations.map((item) => withReview(item, variant)),
    topics: sense.topics.map((topic) => ({
      id: topic.id,
      name: nameIn(topic.name, variant.lang),
      ...reviewed(topic.review, variant),
    })),
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

/** The entry document as a read asks for it, with what other entries supply joined in. */
export function shapeEntry(document: StoredEntry, links: EntryLinks, variant: ReadVariant): PublicEntry {
  const publicParts = new Set(links.publicParts)
  const summaries = (items: StoredSummary[]) => items.map((item) => shapeSummary(item, variant))
  return {
    lang: variant.lang,
    id: document.id,
    lemma: document.lemma,
    frequency: document.frequency,
    pronunciations: document.pronunciations.map((item) => withReview(item, variant)),
    variants: document.variants.map((item) => withReview(item, variant)),
    syllables: document.syllables,
    morphology: document.morphology && {
      parts: document.morphology.parts.map(({ lemma, ...part }) => ({
        ...part,
        ...(publicParts.has(partWord({ lemma, ...part })) ? { lemma: partWord({ lemma, ...part }) } : {}),
      })),
      family: summaries(links.family),
      ...reviewed(document.morphology.review, variant),
    },
    meanings: document.meanings.map((meaning) => ({
      pos: meaning.pos,
      cefr: meaning.cefr,
      pronunciations: meaning.pronunciations.map((item) => withReview(item, variant)),
      forms: meaning.forms,
      senses: meaning.senses.map((sense) => shapeSense(sense, variant)),
      ...(variant.review ? { review: meaning.review } : {}),
    })),
    phrases: summaries(links.phrases),
    ...(variant.review ? { review: document.review } : {}),
  }
}

/** One sense of the document with its part of speech and its entry's summary; null when it has no such sense. */
export function shapeSenseDetail(
  document: StoredEntry,
  senseId: SenseId,
  variant: ReadVariant,
): PublicSenseDetail | null {
  for (const meaning of document.meanings) {
    const sense = meaning.senses.find((candidate) => candidate.id === senseId)
    if (sense) {
      return {
        lang: variant.lang,
        ...shapeSense(sense, variant),
        pos: meaning.pos,
        entry: shapeSummary(document.summary, variant),
      }
    }
  }
  return null
}

/** The entries a form lookup found, one item per entry with every form of it that matched, in row order. */
export function formMatches(
  rows: ReadonlyArray<{ summary: StoredSummary; type: FormType; pos: Pos | null }>,
  variant: ReadVariant,
): FormMatch[] {
  const byLemma = new Map<string, FormMatch>()
  for (const row of rows) {
    const match = byLemma.get(row.summary.lemma) ?? { ...shapeSummary(row.summary, variant), matches: [] }
    match.matches.push({ type: row.type, ...(row.pos ? { pos: row.pos } : {}) })
    byLemma.set(row.summary.lemma, match)
  }
  return [...byLemma.values()]
}
