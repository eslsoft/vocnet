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
import type { EntryId, FactId, FactKind, Morpheme, Pos, RelationType, SenseId, TopicId } from '@shared/facts'
import type { CefrLevel, LemmaReference } from '@shared/reference'
import { type Fact, type FactOf, isKind } from './fact'
import { formClasses } from './fact-kinds'
import type { EntryNode, SenseNode, SenseWithLemma } from './nodes'
import { levelRank } from './reference'
import { listedSenses } from './sense-list'
import { assessEntry } from './work'
/** Everything the read model needs about one entry, in every status. */
export interface EntrySnapshot {
  entry: EntryNode
  /** The entry was submitted as part of a seed list. */
  seed: boolean
  senses: SenseWithLemma[]
  /** Facts whose subject is the entry or one of its senses. */
  facts: Fact[]
  /** Relation facts whose object is one of the entry's senses. */
  incoming: Fact[]
  /** Facts about the entry or its senses that an open or claimed feedback item targets. */
  flagged: ReadonlySet<FactId>
  /** Senses at the other end of the entry's relations, with their `entry` and `sense` facts. */
  neighbors: { senses: SenseWithLemma[]; facts: Fact[] }
}

export interface ManagedEntryView {
  entry: EntryNode
  seed: boolean
  completeness: number
  quality: number
  senses: SenseNode[]
  facts: Fact[]
}

/** The management view: the entry with every fact in every status, including relations pointing at it. */
export function managedEntryView(snapshot: EntrySnapshot): ManagedEntryView {
  const facts = new Map([...snapshot.facts, ...snapshot.incoming].map((fact) => [fact.id, fact]))
  const { completeness, quality } = assessEntry(snapshot)
  return {
    entry: snapshot.entry,
    seed: snapshot.seed,
    completeness,
    quality,
    senses: snapshot.senses,
    facts: [...facts.values()],
  }
}

/** Values by BCP 47 language tag. */
export type ByLanguage<T> = Record<string, T>

// The stored public document: the entry as the public API shows it with every language and every
// review, so one document serves each language and include variant. Reads cut the variant out of
// it (server/domain/public-view.ts); fields other entries supply are joined on read.

export interface StoredSense extends Omit<PublicSense, 'translations' | 'topics' | 'review'> {
  translations: ByLanguage<string[]>
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

export interface StoredEntry {
  id: EntryId
  lemma: string
  frequency: { zipf: number; rank: number } | null
  pronunciations: PublicPronunciation[]
  variants: Variant[]
  morphology: { parts: Morpheme[]; review: ReviewMeta } | null
  meanings: StoredMeaning[]
  summary: StoredSummary
  review: { entry: ReviewMeta; sense_list: ReviewMeta | null }
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
// published. A node is published when its defining fact is. A form or pronunciation of a part of
// speech no public sense has shows once one does.
export function projectPublicEntry(snapshot: EntrySnapshot, context: ProjectionContext): StoredEntry | null {
  const byId = new Map([...snapshot.facts, ...snapshot.incoming, ...snapshot.neighbors.facts].map((f) => [f.id, f]))
  const published = [...byId.values()].filter((fact) => fact.status === 'published')
  const about = <K extends FactKind>(kind: K, subjectId: EntryId | SenseId) =>
    published.filter(isKind(kind)).filter((fact) => fact.subjectId === subjectId)

  const entryFact = about('entry', snapshot.entry.id)[0]
  if (!entryFact) return null

  const senses = new Map([...snapshot.senses, ...snapshot.neighbors.senses].map((sense) => [sense.id, sense]))
  const relatedSense = (id: SenseId, fact: FactOf<'relation'>): RelatedSense[] => {
    const sense = senses.get(id)
    if (!sense || about('entry', sense.entryId).length === 0) return []
    const glossFact = about('sense', id)[0]
    return glossFact
      ? [{ lemma: sense.lemma, sense_id: sense.id, gloss: glossFact.payload.gloss, review: reviewOf(fact) }]
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

  const storedSense = (sense: SenseNode, glossFact: FactOf<'sense'>, rare: boolean): StoredSense => {
    const translations: ByLanguage<string[]> = {}
    const translationReviews: ByLanguage<ReviewMeta[]> = {}
    for (const fact of about('translation', sense.id)) {
      pushTo(translations, fact.payload.language, fact.payload.text)
      pushTo(translationReviews, fact.payload.language, reviewOf(fact))
    }
    const [grammar] = about('grammar', sense.id)
    return {
      id: sense.id,
      gloss: glossFact.payload.gloss,
      labels: glossFact.payload.register ? [glossFact.payload.register] : [],
      rare,
      translations,
      grammar: grammar
        ? {
            ...grammar.payload,
            patterns: grammar.payload.patterns ?? [],
            prepositions: grammar.payload.prepositions ?? [],
            review: reviewOf(grammar),
          }
        : null,
      examples: about('example', sense.id).map((fact) => ({ text: fact.payload.text, review: reviewOf(fact) })),
      collocations: about('collocation', sense.id).map((fact) => ({ ...fact.payload, review: reviewOf(fact) })),
      topics: about('topic', sense.id).map((fact) => ({
        id: fact.payload.topic_id,
        name: topicName(fact.payload.topic_id),
        review: reviewOf(fact),
      })),
      relations: relations(sense.id),
      review: { gloss: reviewOf(glossFact), translations: translationReviews },
    }
  }

  // Senses in the published list's order: common, then extra (rare), then those it does not name.
  const senseList = about('sense_list', snapshot.entry.id)[0]
  const listed = senseList ? listedSenses(senseList.payload) : []
  const extra = new Set(senseList?.payload.extra)
  const ownSenses = new Map(snapshot.senses.map((sense) => [sense.id, sense]))
  const inOrder = [
    ...listed.flatMap((id) => ownSenses.get(id) ?? []),
    ...snapshot.senses.filter((sense) => !listed.includes(sense.id)),
  ]

  // One meaning per part of speech, in the order of its first sense.
  const meanings = new Map<Pos, StoredMeaning>()
  for (const sense of inOrder) {
    const glossFact = about('sense', sense.id)[0]
    if (!glossFact) continue
    const meaning = meanings.get(sense.pos) ?? {
      pos: sense.pos,
      cefr: context.reference.cefr.find((row) => row.pos === sense.pos)?.level ?? null,
      pronunciations: [],
      forms: {},
      senses: [],
      review: { forms: {} },
    }
    meaning.senses.push(storedSense(sense, glossFact, extra.has(sense.id)))
    meanings.set(sense.pos, meaning)
  }

  const pronunciations: PublicPronunciation[] = []
  for (const fact of about('pronunciation', snapshot.entry.id)) {
    const { pos, ...pronunciation } = fact.payload
    const shown = { ...pronunciation, review: reviewOf(fact) }
    if (!pos) pronunciations.push(shown)
    else meanings.get(pos)?.pronunciations.push(shown)
  }

  const variants: Variant[] = []
  for (const fact of about('form', snapshot.entry.id)) {
    const { form, type, pos } = fact.payload
    if (type === 'variant') {
      variants.push({ form, ...(pos ? { pos } : {}), review: reviewOf(fact) })
      continue
    }
    for (const meaningPos of formClasses(type, pos)) {
      const meaning = meanings.get(meaningPos)
      if (!meaning) continue
      pushTo(meaning.forms, type, form)
      pushTo(meaning.review.forms, type, reviewOf(fact))
    }
  }

  const [morphology] = about('morphology', snapshot.entry.id)
  const ordered = [...meanings.values()]
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
    morphology: morphology ? { parts: morphology.payload.parts, review: reviewOf(morphology) } : null,
    meanings: ordered,
    summary: {
      lemma: snapshot.entry.lemma,
      pos: ordered.map((meaning) => meaning.pos),
      cefr: lowestLevel(context.reference.cefr.map((row) => row.level)),
      gloss: first?.gloss ?? null,
      translations: first ? firstOfEach(first.translations) : {},
    },
    review: { entry: reviewOf(entryFact), sense_list: senseList ? reviewOf(senseList) : null },
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
