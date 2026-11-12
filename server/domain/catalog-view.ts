import type {
  InflectionType,
  Meaning,
  PublicPronunciation,
  PublicSense,
  RelatedSense,
  RelationGroup,
  Relations,
  ReviewMeta,
  Variant,
} from '@shared/catalog'
import type {
  EntryId,
  FactId,
  FactKind,
  FormType,
  Morpheme,
  Pos,
  RelationType,
  SenseId,
  Shortening,
  StoredInventorySense,
  TopicId,
} from '@shared/facts'
import type { CefrLevel, LemmaReference } from '@shared/reference'
import { type Fact, type FactOf, isKind } from './fact'
import { formMeaning, isIrregularForm } from './fact-kinds'
import { currentInventory, inventorySenses } from './inventory'
import type { EntryNode, SenseNode } from './nodes'
import { levelRank } from './reference'
import { assessEntry, type SlotCounts } from './work'

/** Everything the read model needs about one entry, in every status. */
export interface EntrySnapshot {
  /** `live`: an imported headword, or a phrase a published phrases list names. */
  entry: EntryNode & { live: boolean }
  /** The headword batch the entry belongs to; null for an entry that is not live. */
  batch: number | null
  /** The entry's learner level: 1 for A1 to 6 for C2 (`levelRank`); null without a CEFR level. */
  levelRank: number | null
  /** The Zipf frequency of the entry's lemma, as its worklist row stores it; null without one. */
  zipf: number | null
  /** The lemmas of the other live entries whose live morphology names this lemma as a base. */
  family: string[]
  /** The sense rows of the entry: every sense any of its inventories ever named. */
  senses: SenseNode[]
  /** Facts whose subject is the entry, one of its senses, or one of their examples and collocations. */
  facts: Fact[]
  /** Relation facts whose object is one of the entry's senses. */
  incoming: Fact[]
  /** The optional slots a pass completed, keyed `type|subject`. */
  passes: ReadonlySet<string>
  /**
   * The entries at the other end of the entry's relations: their inventories, their lemmas, and
   * which of them are live.
   */
  neighbors: { inventories: Fact[]; lemmas: ReadonlyMap<EntryId, string>; liveEntries: ReadonlySet<EntryId> }
}

export interface ManagedEntryView {
  entry: EntryNode & { live: boolean }
  batch: number | null
  completeness: number
  credibility: number
  slots: SlotCounts
  senses: SenseNode[]
  facts: Fact[]
}

/** The management view: the entry with every fact in every status, including relations pointing at it. */
export function managedEntryView(snapshot: EntrySnapshot): ManagedEntryView {
  const facts = new Map([...snapshot.facts, ...snapshot.incoming].map((fact) => [fact.id, fact]))
  const { completeness, credibility, slots } = assessEntry(snapshot)
  return {
    entry: snapshot.entry,
    batch: snapshot.batch,
    completeness,
    credibility,
    slots,
    senses: snapshot.senses,
    facts: [...facts.values()],
  }
}

/** Values by BCP 47 language tag. */
export type ByLanguage<T> = Record<string, T>

// The stored public document: the entry as the public API shows it with every language and every
// review, so one document serves each language and include variant. Reads cut the variant out of
// it (server/domain/public-view.ts); fields other entries supply are joined on read.

export interface StoredSense
  extends Omit<PublicSense, 'translations' | 'topics' | 'review' | 'examples' | 'collocations'> {
  translations: ByLanguage<string[]>
  examples: Array<{ text: string; translations: ByLanguage<string>; review: ReviewMeta }>
  collocations: Array<{
    text: string
    pattern: PublicSense['collocations'][number]['pattern']
    translations: ByLanguage<string>
    review: ReviewMeta
  }>
  topics: Array<{ id: TopicId; name: ByLanguage<string>; review: ReviewMeta }>
  review: { gloss: ReviewMeta; translations: ByLanguage<ReviewMeta[]> }
}

export interface StoredMeaning extends Omit<Meaning, 'senses' | 'review'> {
  senses: StoredSense[]
  review: { forms: Partial<Record<InflectionType, ReviewMeta[]>> }
}

/** An entry as lists show it, with its first sense's first translation in every language. */
export interface StoredSummary {
  lemma: string
  pos: Pos[]
  cefr: CefrLevel | null
  gloss: string | null
  translations: ByLanguage<string>
}

/** One sense as topic listings show it. */
export interface StoredSenseSummary {
  lemma: string
  sense_id: SenseId
  pos: Pos
  cefr: CefrLevel | null
  gloss: string
  translations: ByLanguage<string>
}

/** One published form of a public entry as the form lookup indexes it, shown or not. */
export interface IndexedForm {
  form: string
  type: FormType
  /** The part of speech it is shown under, else its own label, else null. */
  pos: Pos | null
}

export interface StoredEntry {
  id: EntryId
  lemma: string
  frequency: { zipf: number; rank: number } | null
  pronunciations: PublicPronunciation[]
  variants: Variant[]
  syllables: string[] | null
  morphology: { parts: Morpheme[]; shortened?: Shortening; review: ReviewMeta } | null
  meanings: StoredMeaning[]
  summary: StoredSummary
  /** The lemmas the headword's published phrases list names, in its order; reads join their summaries. */
  phrases: string[]
  review: {
    inventory: ReviewMeta
    syllables: ReviewMeta | null
    phrases: ReviewMeta | null
  }
  /**
   * Every published form, independent of display: a lookup never depends on presentation. Reads
   * do not show it; the view indexes it (server/domain/public-view.ts).
   */
  forms: IndexedForm[]
}

/** What a public document needs besides the entry's own facts. */
export interface ProjectionContext {
  reference: LemmaReference
  /** Each leaf topic's name by language tag. */
  topicNames: ReadonlyMap<TopicId, ByLanguage<string>>
}

/** Published facts always carry the review that published them. */
export function reviewOf(fact: Fact): ReviewMeta {
  if (fact.status !== 'published' || !fact.review) throw new Error(`Fact ${fact.id} is not a reviewed published fact.`)
  return { fact_id: fact.id, confidence: fact.review.confidence, verdict: fact.review.verdict }
}

// Symmetric types read the same from both ends; the directed ones name each end.
const OUTGOING: Record<RelationType, RelationGroup> = {
  synonym: 'synonyms',
  antonym: 'antonyms',
  hypernym: 'broader',
  part_of: 'part_of',
}
const INCOMING: Record<RelationType, RelationGroup> = {
  synonym: 'synonyms',
  antonym: 'antonyms',
  hypernym: 'narrower',
  part_of: 'parts',
}

const noRelations = (): Relations => ({ synonyms: [], antonyms: [], broader: [], narrower: [], part_of: [], parts: [] })

/** The first value of each language. */
export const firstOfEach = (values: ByLanguage<string[]>): ByLanguage<string> =>
  Object.fromEntries(
    Object.entries(values).flatMap(([language, texts]) => texts.slice(0, 1).map((first) => [language, first])),
  )

function pushTo<K extends string, T>(groups: Partial<Record<K, T[]>>, key: K, value: T) {
  groups[key] = [...(groups[key] ?? []), value]
}

const lowestLevel = (levels: CefrLevel[]): CefrLevel | null =>
  levels.reduce<CefrLevel | null>(
    (lowest, level) => (lowest && levelRank(lowest) <= levelRank(level) ? lowest : level),
    null,
  )

// Visibility is derived on read: a fact shows only when it and every node it references are
// published. An entry shows when it is live and its inventory is published; a sense when that
// inventory lists it; a relation when the other end's live entry lists it in its published
// inventory; a translation with the sense, example, or collocation it translates. A form or
// pronunciation is shown under a meaning, so one with no meaning to show it is shown once a sense
// of a part of speech that can carry it is published; the form lookup indexes every published form
// regardless.
export function projectPublicEntry(snapshot: EntrySnapshot, context: ProjectionContext): StoredEntry | null {
  if (!snapshot.entry.live) return null
  const isPublished = (fact: Fact) => fact.status === 'published'
  const published = [...snapshot.facts, ...snapshot.incoming].filter(isPublished)
  const about = <K extends FactKind>(kind: K, subjectId: string) =>
    published.filter(isKind(kind)).filter((fact) => fact.subjectId === subjectId)

  const inventory = currentInventory(snapshot.facts, (status) => status === 'published')
  if (!inventory) return null

  // The senses a relation may show at its other end: listed by a live entry's published inventory.
  const shownSenses = new Map<SenseId, { lemma: string; gloss: string }>()
  const byEntry = new Map<EntryId, Fact[]>()
  for (const fact of snapshot.neighbors.inventories) {
    byEntry.set(fact.subjectId as EntryId, [...(byEntry.get(fact.subjectId as EntryId) ?? []), fact])
  }
  for (const [entryId, facts] of byEntry) {
    const lemma = snapshot.neighbors.lemmas.get(entryId)
    if (!lemma || !snapshot.neighbors.liveEntries.has(entryId)) continue
    for (const sense of inventorySenses(currentInventory(facts, (status) => status === 'published'))) {
      shownSenses.set(sense.id, { lemma, gloss: sense.gloss })
    }
  }
  for (const sense of inventory.payload.senses) shownSenses.set(sense.id, { lemma: snapshot.entry.lemma, gloss: sense.gloss })

  const relatedSense = (id: SenseId, fact: FactOf<'relation'>): RelatedSense[] => {
    const shown = shownSenses.get(id)
    return shown
      ? [
          {
            lemma: shown.lemma,
            sense_id: id,
            gloss: shown.gloss,
            ...(fact.payload.domain ? { domain: fact.payload.domain } : {}),
            review: reviewOf(fact),
          },
        ]
      : []
  }

  const relations = (senseId: SenseId): Relations => {
    const groups = noRelations()
    for (const fact of about('relation', senseId)) {
      groups[OUTGOING[fact.payload.type]].push(...relatedSense(fact.payload.target_sense_id, fact))
    }
    for (const fact of published.filter(isKind('relation')).filter((candidate) => candidate.objectId === senseId)) {
      groups[INCOMING[fact.payload.type]].push(...relatedSense(fact.subjectId, fact))
    }
    return groups
  }

  const topicName = (id: TopicId) => {
    const name = context.topicNames.get(id)
    if (!name) throw new Error(`Topic ${id} of a published topic fact does not exist.`)
    return name
  }

  /** The published translations of a node, by language. */
  const translationsOf = (subjectId: string): ByLanguage<string> =>
    Object.fromEntries(about('translation', subjectId).map((fact) => [fact.payload.language, fact.payload.text]))

  const storedSense = (sense: StoredInventorySense): StoredSense => {
    const translations: ByLanguage<string[]> = {}
    const translationReviews: ByLanguage<ReviewMeta[]> = {}
    for (const fact of about('translation', sense.id)) {
      pushTo(translations, fact.payload.language, fact.payload.text)
      pushTo(translationReviews, fact.payload.language, reviewOf(fact))
    }
    const [grammar] = about('grammar', sense.id)
    return {
      id: sense.id,
      gloss: sense.gloss,
      labels: sense.register ? [sense.register] : [],
      region: sense.region ?? null,
      rare: sense.rank === 'extra',
      translations,
      grammar: grammar
        ? {
            ...grammar.payload,
            patterns: grammar.payload.patterns ?? [],
            prepositions: grammar.payload.prepositions ?? [],
            review: reviewOf(grammar),
          }
        : null,
      examples: about('example', sense.id).map((fact) => ({
        text: fact.payload.text,
        translations: translationsOf(fact.id),
        review: reviewOf(fact),
      })),
      collocations: about('collocation', sense.id).map((fact) => ({
        text: fact.payload.text,
        pattern: fact.payload.pattern,
        translations: translationsOf(fact.id),
        review: reviewOf(fact),
      })),
      topics: about('topic', sense.id).map((fact) => ({
        id: fact.payload.topic_id,
        name: topicName(fact.payload.topic_id),
        review: reviewOf(fact),
      })),
      relations: relations(sense.id),
      review: { gloss: reviewOf(inventory), translations: translationReviews },
    }
  }

  // One meaning per part of speech, in the order of its first sense in the inventory.
  const meanings = new Map<Pos, StoredMeaning>()
  for (const sense of inventory.payload.senses) {
    const meaning = meanings.get(sense.pos) ?? {
      pos: sense.pos,
      cefr: context.reference.cefr.find((row) => row.pos === sense.pos)?.level ?? null,
      pronunciations: [],
      forms: {},
      senses: [],
      review: { forms: {} },
    }
    meaning.senses.push(storedSense(sense))
    meanings.set(sense.pos, meaning)
  }

  const pronunciations: PublicPronunciation[] = []
  for (const fact of about('pronunciation', snapshot.entry.id)) {
    const { pos, ...pronunciation } = fact.payload
    const shown = { ...pronunciation, review: reviewOf(fact) }
    if (!pos) pronunciations.push(shown)
    else meanings.get(pos)?.pronunciations.push(shown)
  }

  const ordered = [...meanings.values()]
  const variants: Variant[] = []
  const forms: IndexedForm[] = []
  for (const fact of about('form', snapshot.entry.id)) {
    const { form, type, pos } = fact.payload
    if (type === 'variant') {
      variants.push({ form, ...(pos ? { pos } : {}), review: reviewOf(fact) })
      forms.push({ form, type, pos: pos ?? null })
      continue
    }
    const meaning = formMeaning(type, pos, ordered)
    if (meaning) {
      const { ipa, accent } = fact.payload
      const irregular = isIrregularForm(snapshot.entry.lemma, type, form)
      pushTo(meaning.forms, type, { form, irregular, ...(ipa && accent ? { ipa, accent } : {}) })
      pushTo(meaning.review.forms, type, reviewOf(fact))
    }
    forms.push({ form, type, pos: meaning?.pos ?? pos ?? null })
  }

  const [morphology] = about('morphology', snapshot.entry.id)
  const [syllables] = about('syllables', snapshot.entry.id)
  const [phrases] = about('phrases', snapshot.entry.id)
  const first = ordered[0]?.senses[0]
  return {
    id: snapshot.entry.id,
    lemma: snapshot.entry.lemma,
    frequency: context.reference.frequency && {
      zipf: context.reference.frequency.zipf,
      rank: context.reference.frequency.rank,
    },
    pronunciations,
    variants,
    syllables: syllables ? syllables.payload.syllables : null,
    morphology: morphology ? { ...morphology.payload, review: reviewOf(morphology) } : null,
    meanings: ordered,
    summary: {
      lemma: snapshot.entry.lemma,
      pos: ordered.map((meaning) => meaning.pos),
      cefr: lowestLevel(context.reference.cefr.map((row) => row.level)),
      gloss: first?.gloss ?? null,
      translations: first ? firstOfEach(first.translations) : {},
    },
    phrases: phrases ? phrases.payload.phrases : [],
    review: {
      inventory: reviewOf(inventory),
      syllables: syllables ? reviewOf(syllables) : null,
      phrases: phrases ? reviewOf(phrases) : null,
    },
    forms,
  }
}

/** Every fact a public document shows, so "is this fact public" has one answer. */
export function publicFactIds(document: StoredEntry): Set<FactId> {
  const ids = new Set<FactId>()
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) value.forEach(walk)
    else if (value !== null && typeof value === 'object') {
      for (const [key, item] of Object.entries(value)) {
        if (key === 'fact_id') ids.add(item as FactId)
        else walk(item)
      }
    }
  }
  walk(document)
  return ids
}
