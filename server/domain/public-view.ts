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
import {
  type ByLanguage,
  firstOfEach,
  type StoredEntry,
  type StoredSense,
  type StoredSenseSummary,
  type StoredSummary,
} from './catalog-view'
import { contentKeyOf } from './fact-kinds'
import { isMultiword } from './term'

// The public view stores each entry's public document, built by the same projection that defines
// visibility, plus the lookup rows the other public reads need. Everything here derives from the
// document, so the view can never say more than the projection does. A read cuts the requested
// language and review variant out of the stored document and joins what other entries supply.

/** The rows the public view stores for one entry. */
export interface PublicViewRecord {
  document: StoredEntry
  /** One per published form, shown or not, with the part of speech it is shown under, keyed like the form fact. */
  forms: Array<{ contentKey: string; type: FormType; pos: Pos | null }>
  /** One per published topic tag of a public sense. */
  taggedSenses: Array<{ topicId: TopicId; summary: StoredSenseSummary }>
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

export function publicViewRecord(document: StoredEntry): PublicViewRecord {
  const parts = document.morphology?.parts ?? []
  return {
    document,
    forms: document.forms.map(({ form, type, pos }) => ({
      contentKey: contentKeyOf('form', { form, type }),
      type,
      pos,
    })),
    taggedSenses: document.meanings.flatMap((meaning) =>
      meaning.senses.flatMap((sense) =>
        sense.topics.map((topic) => ({
          topicId: topic.id,
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
      ...new Map(parts.map((part) => [`${part.role}:${part.form}`, { form: part.form, role: part.role }])).values(),
    ],
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
    rare: sense.rare,
    ...(translations === undefined ? {} : { translations }),
    grammar: sense.grammar && withReview(sense.grammar, variant),
    examples: sense.examples.map((item) => withReview(item, variant)),
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
    morphology: document.morphology && {
      parts: document.morphology.parts.map((part) => ({
        ...part,
        ...(publicParts.has(part.form) ? { lemma: part.form } : {}),
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
