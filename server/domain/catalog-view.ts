import type {
  FactMeta,
  FormMatch,
  PublicEntry,
  PublicRelation,
  PublicSense,
  PublicSenseWithEntry,
} from '@shared/catalog'
import type { EntryId, FactKind, SenseId } from '@shared/facts'
import { type Fact, type FactOf, isKind } from './fact'
import type { EntryNode, SenseWithLemma } from './nodes'

/** Everything the read model needs about one entry, in every status. */
export interface EntrySnapshot {
  entry: EntryNode
  senses: SenseWithLemma[]
  /** Facts whose subject is the entry or one of its senses. */
  facts: Fact[]
  /** Relation facts whose object is one of the entry's senses. */
  incoming: Fact[]
  /** Senses at the other end of the entry's relations, with their `entry` and `sense` facts. */
  neighbors: { senses: SenseWithLemma[]; facts: Fact[] }
}

/** Published facts always carry the review that published them. */
export function factMeta(fact: Fact): FactMeta {
  if (fact.status !== 'published' || !fact.review) throw new Error(`Fact ${fact.id} is not a reviewed published fact.`)
  return { id: fact.id, confidence: fact.review.confidence, verdict: fact.review.verdict }
}

export function formMatch(entry: EntryNode, fact: FactOf<'form'>): FormMatch {
  return {
    entry: { id: entry.id, lemma: entry.lemma },
    form: { ...factMeta(fact), form: fact.payload.form, type: fact.payload.type },
  }
}

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
    forms: about('form', snapshot.entry.id).map((fact) => ({
      ...factMeta(fact),
      form: fact.payload.form,
      type: fact.payload.type,
    })),
    pronunciations: about('pronunciation', snapshot.entry.id).map((fact) => ({
      ...factMeta(fact),
      ipa: fact.payload.ipa,
      accent: fact.payload.accent,
    })),
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
