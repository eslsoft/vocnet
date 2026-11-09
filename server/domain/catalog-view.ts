import type {
  FactMeta,
  FormMatch,
  PublicEntry,
  PublicRelation,
  PublicSense,
  PublicSenseWithEntry,
} from '@shared/catalog'
import type { EntryId, FactId, FactKind, SenseId } from '@shared/facts'
import { type Fact, type FactOf, isKind } from './fact'
import type { EntryNode, SenseNode, SenseWithLemma } from './nodes'
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
export function projectPublicEntry(snapshot: EntrySnapshot): PublicEntry | null {
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

  const publicSenses = snapshot.senses.flatMap((sense): PublicSense[] => {
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
      },
    ]
  })

  return {
    id: snapshot.entry.id,
    lemma: snapshot.entry.lemma,
    fact: factMeta(entryFact),
    forms: about('form', snapshot.entry.id).map(publicForm),
    pronunciations: about('pronunciation', snapshot.entry.id).map((fact) => ({ ...factMeta(fact), ...fact.payload })),
    senses: publicSenses,
  }
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
export function publicFactIds(view: PublicEntry): Set<FactId> {
  const senseFacts = view.senses.flatMap((sense) => [
    sense.fact,
    ...sense.examples,
    ...sense.translations,
    ...sense.relations,
  ])
  return new Set([view.fact, ...view.forms, ...view.pronunciations, ...senseFacts].map((fact) => fact.id))
}
