import type {
  CefrSource,
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
  EntryPhraseType,
  FactId,
  FactKind,
  FormType,
  Morpheme,
  Pos,
  RelationType,
  SenseId,
  SentenceId,
  Shortening,
  StoredInventorySense,
  TopicId,
} from '@shared/facts'
import { CURATOR } from '@shared/facts'
import type { MediaId } from '@shared/media'
import type { CefrLevel, LemmaReference } from '@shared/reference'
import { type Fact, type FactOf, isKind } from './fact'
import { formMeaning, isIrregularForm, type NamedNodes } from './fact-kinds'
import { currentInventory, inventorySenses } from './inventory'
import type { EntryNode, SenseNode, SentenceNode } from './nodes'
import { skillsOf } from './productive-use'
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
  /** The type the earliest published phrases list naming the entry gives it; null for a single word or an unlisted entry. */
  phraseType: EntryPhraseType | null
  /** The sentences of the entry's examples and of the sayings its phrases lists name. */
  sentences: ReadonlyMap<SentenceId, SentenceNode>
  /** The lemmas of the entries its phrases lists name, by id. */
  phraseEntries: ReadonlyMap<EntryId, string>
  /** The sense rows of the entry: every sense any of its inventories ever named. */
  senses: SenseNode[]
  /** Facts whose subject is the entry, one of its senses, one of their collocations, or one of its sentences. */
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
  phraseType: EntryPhraseType | null
  completeness: number
  credibility: number
  slots: SlotCounts
  senses: SenseNode[]
  facts: Fact[]
}

/** What a view names by id, with the texts the snapshot read: its sentences and its phrase entries. */
export const namedNodesOf = (snapshot: Pick<EntrySnapshot, 'sentences' | 'phraseEntries'>): NamedNodes => ({
  entries: snapshot.phraseEntries,
  sentences: new Map([...snapshot.sentences].map(([id, sentence]) => [id, sentence.text])),
})

/**
 * The fact as a view shows it: an example with its sentence's text, a phrases list with each
 * item's lemma or text, so a reader needs no further read. The stored payload holds only ids.
 */
export function withNamedTexts(fact: Fact, named: NamedNodes): Fact {
  if (fact.kind === 'example') {
    const text = named.sentences.get(fact.payload.sentence_id)
    return text === undefined ? fact : { ...fact, payload: { ...fact.payload, text } }
  }
  if (fact.kind === 'phrases') {
    const phrases = fact.payload.phrases.map((item) => {
      const text = item.type === 'saying' ? named.sentences.get(item.sentence_id) : named.entries.get(item.entry_id)
      return text === undefined ? item : { ...item, text }
    })
    return { ...fact, payload: { phrases } }
  }
  return fact
}

/** The management view: the entry with every fact in every status, including relations pointing at it. */
export function managedEntryView(snapshot: EntrySnapshot): ManagedEntryView {
  const named = namedNodesOf(snapshot)
  const facts = new Map([...snapshot.facts, ...snapshot.incoming].map((fact) => [fact.id, withNamedTexts(fact, named)]))
  const { completeness, credibility, slots } = assessEntry(snapshot)
  return {
    entry: snapshot.entry,
    batch: snapshot.batch,
    phraseType: snapshot.phraseType,
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

/** A published picture as the document stores it, with the review of its image fact. */
export interface StoredPicture {
  /** The media id; a read composes the URL from the configured base. */
  image_id: MediaId
  sentence: string | null
  review: ReviewMeta
}

export interface StoredSense
  extends Omit<PublicSense, 'translations' | 'topics' | 'review' | 'examples' | 'collocations' | 'image'> {
  translations: ByLanguage<string[]>
  examples: Array<{ sentence_id: SentenceId; text: string; translations: ByLanguage<string>; review: ReviewMeta }>
  collocations: Array<{
    text: string
    pattern: PublicSense['collocations'][number]['pattern']
    translations: ByLanguage<string>
    review: ReviewMeta
  }>
  topics: Array<{ id: TopicId; name: ByLanguage<string>; review: ReviewMeta }>
  image: StoredPicture | null
  review: { gloss: ReviewMeta; translations: ByLanguage<ReviewMeta[]> }
}

export interface StoredMeaning extends Omit<Meaning, 'senses' | 'review'> {
  senses: StoredSense[]
  review: { forms: Partial<Record<InflectionType, ReviewMeta[]>>; productive_use: ReviewMeta | null }
}

/** An entry as lists show it, with its first sense's first translation in every language. */
export interface StoredSummary {
  lemma: string
  pos: Pos[]
  cefr: CefrLevel | null
  cefr_source: CefrSource | null
  gloss: string | null
  translations: ByLanguage<string>
  /** The media id of its picture; a read composes the URL from the configured base. */
  image_id: MediaId | null
}

/** One sense as topic listings show it. */
export interface StoredSenseSummary {
  lemma: string
  sense_id: SenseId
  pos: Pos
  cefr: CefrLevel | null
  cefr_source: CefrSource | null
  gloss: string
  translations: ByLanguage<string>
  /** The media id of its picture; a read composes the URL from the configured base. */
  image_id: MediaId | null
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
  /** The lowest level of the lemma, and where it comes from. */
  cefr: CefrLevel | null
  cefr_source: CefrSource | null
  /** The picture of the first sense, in inventory order, that has one. */
  image: (StoredPicture & { sense_id: SenseId }) | null
  meanings: StoredMeaning[]
  summary: StoredSummary
  /**
   * The entries the headword's published phrases list names, in its order, with their type and the
   * sense they are filed under; reads join their summaries.
   */
  phrases: StoredPhrase[]
  /** The sayings the headword's published phrases list names, in its order. */
  sayings: StoredSaying[]
  /** The type the earliest published list naming a phrase entry gives it; null for a single word. */
  phrase_type: EntryPhraseType | null
  review: {
    inventory: ReviewMeta
    syllables: ReviewMeta | null
    phrases: ReviewMeta | null
    cefr: ReviewMeta | null
  }
  /**
   * Every published form, independent of display: a lookup never depends on presentation. Reads
   * do not show it; the view indexes it (server/domain/public-view.ts).
   */
  forms: IndexedForm[]
}

export interface StoredPhrase {
  type: EntryPhraseType
  lemma: string
  sense_id: SenseId | null
}

export interface StoredSaying {
  sentence_id: SentenceId
  text: string
  meaning: string | null
  translations: ByLanguage<string>
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
  for (const sense of inventory.payload.senses)
    shownSenses.set(sense.id, { lemma: snapshot.entry.lemma, gloss: sense.gloss })

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

  /**
   * The sense's published picture. A picture of an example shows only while a published example
   * links that sentence to the sense, since it is always shown with the sentence.
   */
  const pictureOf = (senseId: SenseId): StoredPicture | null => {
    const [fact] = about('image', senseId)
    if (!fact) return null
    const { image_id, sentence_id } = fact.payload
    let sentence: string | null = null
    if (sentence_id !== undefined) {
      const example = about('example', senseId).some((candidate) => candidate.payload.sentence_id === sentence_id)
      const text = snapshot.sentences.get(sentence_id)?.text
      if (!example || text === undefined) return null
      sentence = text
    }
    return { image_id, sentence, review: reviewOf(fact) }
  }

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
      examples: about('example', sense.id).flatMap((fact) => {
        const sentence = snapshot.sentences.get(fact.payload.sentence_id)
        if (!sentence)
          throw new Error(`Example ${fact.id} names sentence ${fact.payload.sentence_id}, which does not exist.`)
        return [
          {
            sentence_id: sentence.id,
            text: sentence.text,
            translations: translationsOf(sentence.id),
            review: reviewOf(fact),
          },
        ]
      }),
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
      image: pictureOf(sense.id),
      relations: relations(sense.id),
      review: { gloss: reviewOf(inventory), translations: translationReviews },
    }
  }

  // An entry the reference lists give no level takes its published cefr fact's, for every part of
  // speech; the server estimates one, or a curator imports one, only for such an entry.
  const [levelFact] = context.reference.cefr.length > 0 ? [] : about('cefr', snapshot.entry.id)
  const levelOf = (pos: Pos) =>
    context.reference.cefr.find((row) => row.pos === pos)?.level ?? levelFact?.payload.level ?? null
  const cefr = lowestLevel(context.reference.cefr.map((row) => row.level)) ?? levelFact?.payload.level ?? null
  const cefrSource: CefrSource | null =
    context.reference.cefr.length > 0
      ? 'reference'
      : levelFact
        ? levelFact.review?.reviewer === CURATOR
          ? 'curated'
          : 'estimated'
        : null

  // One meaning per part of speech, in the order of its first sense in the inventory.
  const meanings = new Map<Pos, StoredMeaning>()
  let image: StoredEntry['image'] = null
  for (const sense of inventory.payload.senses) {
    const meaning: StoredMeaning = meanings.get(sense.pos) ?? {
      pos: sense.pos,
      cefr: levelOf(sense.pos),
      productive_use: null,
      skills: null,
      pronunciations: [],
      forms: {},
      senses: [],
      review: { forms: {}, productive_use: null },
    }
    const stored = storedSense(sense)
    if (!image && stored.image) image = { ...stored.image, sense_id: sense.id }
    meaning.senses.push(stored)
    meanings.set(sense.pos, meaning)
  }

  // A part of speech with only rare senses is passive for both tiers; any other shows its published
  // productive use, with the skills its common senses' registers give each tier.
  const uses = about('productive_use', snapshot.entry.id)
  for (const meaning of meanings.values()) {
    const common = inventory.payload.senses.filter((sense) => sense.pos === meaning.pos && sense.rank === 'common')
    const fact = common.length === 0 ? undefined : uses.find((use) => use.payload.pos === meaning.pos)
    const use = common.length === 0 ? { native: false, learner: false } : fact?.payload
    if (!use) continue
    const registers = common.map((sense) => sense.register)
    meaning.productive_use = { native: use.native, learner: use.learner }
    meaning.skills = { native: skillsOf(use.native, registers), learner: skillsOf(use.learner, registers) }
    if (fact) meaning.review.productive_use = reviewOf(fact)
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
  const listed = phrases?.payload.phrases ?? []
  const storedPhrases = listed.flatMap((item): StoredPhrase[] => {
    if (item.type === 'saying') return []
    const lemma = snapshot.phraseEntries.get(item.entry_id)
    return lemma ? [{ type: item.type, lemma, sense_id: item.sense_id ?? null }] : []
  })
  const sayings = listed.flatMap((item): StoredSaying[] => {
    if (item.type !== 'saying') return []
    const sentence = snapshot.sentences.get(item.sentence_id)
    if (!sentence) return []
    const [meaning] = about('sentence_meaning', sentence.id)
    return [
      {
        sentence_id: sentence.id,
        text: sentence.text,
        meaning: meaning ? meaning.payload.gloss : null,
        translations: translationsOf(sentence.id),
      },
    ]
  })
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
    cefr,
    cefr_source: cefrSource,
    image,
    meanings: ordered,
    summary: {
      lemma: snapshot.entry.lemma,
      pos: ordered.map((meaning) => meaning.pos),
      cefr,
      cefr_source: cefrSource,
      gloss: first?.gloss ?? null,
      translations: first ? firstOfEach(first.translations) : {},
      image_id: image?.image_id ?? null,
    },
    phrases: storedPhrases,
    sayings,
    phrase_type: snapshot.phraseType,
    review: {
      inventory: reviewOf(inventory),
      syllables: syllables ? reviewOf(syllables) : null,
      phrases: phrases ? reviewOf(phrases) : null,
      cefr: levelFact ? reviewOf(levelFact) : null,
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
