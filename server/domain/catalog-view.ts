import type {
  FactMeta,
  FormMatch,
  PublicEntry,
  PublicRelation,
  PublicSense,
  PublicSenseWithEntry,
} from '@shared/catalog'
import type { EntryId, FactId, FactKind, SenseId } from '@shared/facts'
import type { LemmaReference } from '@shared/reference'
import { type Fact, type FactOf, isKind } from './fact'
import type { EntryNode, SenseNode, SenseWithLemma } from './nodes'
import { listedSenses } from './sense-list'
import { assessEntry } from './work'

/** The public entry as its facts make it, before the imported reference data joins it. */
export type PublicEntryFacts = Omit<PublicEntry, keyof LemmaReference>

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

/** Published facts always carry the review that published them. */
export function factMeta(fact: Fact): FactMeta {
  if (fact.status !== 'published' || !fact.review) throw new Error(`Fact ${fact.id} is not a reviewed published fact.`)
  return { id: fact.id, confidence: fact.review.confidence, verdict: fact.review.verdict }
}

export function formMatch(entry: EntryNode, fact: FactOf<'form'>): FormMatch {
  return {
    entry: { id: entry.id, lemma: entry.lemma },
    form: publicForm(fact),
  }
}

const publicForm = (fact: FactOf<'form'>) => ({ ...factMeta(fact), ...fact.payload })

// Visibility is derived on read: a fact shows only when it and every node it
// references are published. A node is published when its defining fact is.
export function projectPublicEntry(snapshot: EntrySnapshot): PublicEntryFacts | null {
  const byId = new Map([...snapshot.facts, ...snapshot.incoming, ...snapshot.neighbors.facts].map((f) => [f.id, f]))
  const published = [...byId.values()].filter((fact) => fact.status === 'published')
  const about = <K extends FactKind>(kind: K, subjectId: EntryId | SenseId) =>
    published.filter(isKind(kind)).filter((fact) => fact.subjectId === subjectId)

  const entryFact = about('entry', snapshot.entry.id)[0]
  if (!entryFact) return null

  const senses = new Map([...snapshot.senses, ...snapshot.neighbors.senses].map((sense) => [sense.id, sense]))
  const visibleSense = (id: SenseId) => {
    const sense = senses.get(id)
    if (!sense || about('entry', sense.entryId).length === 0) return null
    const glossFact = about('sense', id)[0]
    return glossFact ? { sense, glossFact } : null
  }

  const relations = (senseId: SenseId): PublicRelation[] => {
    const outgoing = about('relation', senseId).flatMap((fact) => {
      const other = visibleSense(fact.payload.target_sense_id)
      return other ? [relation(fact, 'outgoing', other)] : []
    })
    const incoming = published
      .filter(isKind('relation'))
      .filter((fact) => fact.objectId === senseId)
      .flatMap((fact) => {
        const other = visibleSense(fact.subjectId)
        return other ? [relation(fact, 'incoming', other)] : []
      })
    return [...outgoing, ...incoming]
  }

  // Senses in the published list's order, common first; those it does not name come last.
  const senseList = about('sense_list', snapshot.entry.id)[0]
  const listed = new Set(senseList ? listedSenses(senseList.payload) : [])
  const common = new Set(senseList?.payload.common)
  const ownSenses = new Map(snapshot.senses.map((sense) => [sense.id, sense]))
  const inOrder = [
    ...[...listed].flatMap((id) => ownSenses.get(id) ?? []),
    ...snapshot.senses.filter((sense) => !listed.has(sense.id)),
  ]

  const publicSenses = inOrder.flatMap((sense): PublicSense[] => {
    const glossFact = about('sense', sense.id)[0]
    if (!glossFact) return []
    return [
      {
        id: sense.id,
        pos: sense.pos,
        gloss: glossFact.payload.gloss,
        register: glossFact.payload.register,
        fact: factMeta(glossFact),
        examples: about('example', sense.id).map((fact) => ({ ...factMeta(fact), text: fact.payload.text })),
        translations: about('translation', sense.id).map((fact) => ({
          ...factMeta(fact),
          language: fact.payload.language,
          text: fact.payload.text,
        })),
        relations: relations(sense.id),
        topics: about('topic', sense.id).map((fact) => ({ ...factMeta(fact), topic_id: fact.payload.topic_id })),
        grammar: publicOne(about('grammar', sense.id), (fact) => fact.payload),
        collocations: about('collocation', sense.id).map((fact) => ({ ...factMeta(fact), ...fact.payload })),
        common: listed.has(sense.id) ? common.has(sense.id) : null,
      },
    ]
  })

  return {
    id: snapshot.entry.id,
    lemma: snapshot.entry.lemma,
    fact: factMeta(entryFact),
    forms: about('form', snapshot.entry.id).map(publicForm),
    pronunciations: about('pronunciation', snapshot.entry.id).map((fact) => ({ ...factMeta(fact), ...fact.payload })),
    morphology: publicOne(about('morphology', snapshot.entry.id), (fact) => fact.payload),
    sense_list: senseList ? factMeta(senseList) : null,
    senses: publicSenses,
  }
}

/** The published fact of a `one` kind, if any, as its payload with its meta. */
function publicOne<F extends Fact, T extends object>(published: F[], view: (fact: F) => T): (FactMeta & T) | null {
  const [fact] = published
  return fact ? { ...factMeta(fact), ...view(fact) } : null
}

function relation(
  fact: FactOf<'relation'>,
  direction: PublicRelation['direction'],
  other: { sense: SenseWithLemma; glossFact: FactOf<'sense'> },
): PublicRelation {
  return {
    ...factMeta(fact),
    type: fact.payload.type,
    direction,
    sense: { id: other.sense.id, lemma: other.sense.lemma, pos: other.sense.pos, gloss: other.glossFact.payload.gloss },
  }
}

export function projectPublicSense(snapshot: EntrySnapshot, senseId: SenseId): PublicSenseWithEntry | null {
  const entry = projectPublicEntry(snapshot)
  const sense = entry?.senses.find((candidate) => candidate.id === senseId)
  return entry && sense ? { ...sense, entry: { id: entry.id, lemma: entry.lemma } } : null
}

/** Every fact a public entry view shows, so "is this fact public" has one answer. */
export function publicFactIds(view: PublicEntryFacts): Set<FactId> {
  const senseFacts = view.senses.flatMap((sense) => [
    sense.fact,
    ...sense.examples,
    ...sense.translations,
    ...sense.relations,
    ...sense.topics,
    ...(sense.grammar ? [sense.grammar] : []),
    ...sense.collocations,
  ])
  const entryOnes = [view.morphology, view.sense_list].filter((fact) => fact !== null)
  return new Set([view.fact, ...view.forms, ...view.pronunciations, ...entryOnes, ...senseFacts].map((fact) => fact.id))
}
