import type { EntryId, FactId, FactKind, FactPayloads, FactStatus, Review, SenseId } from '@shared/facts'
import type { SubjectTypeOf } from './fact-kinds'
import type { PrincipalRef } from './principal'

type SubjectIdOf<K extends FactKind> = { entry: EntryId; sense: SenseId }[SubjectTypeOf[K]]

export interface FactOf<K extends FactKind> {
  id: FactId
  kind: K
  subjectId: SubjectIdOf<K>
  objectId: SenseId | null
  contentKey: string
  payload: FactPayloads[K]
  status: FactStatus
  supersedesId: FactId | null
  author: PrincipalRef
  review: Review | null
  /** Set while a live fact awaits a review against a corrected gloss. */
  revalidateSince: string | null
  createdAt: string
  updatedAt: string
}

export type Fact = { [K in FactKind]: FactOf<K> }[FactKind]

export function isKind<K extends FactKind>(kind: K) {
  return (fact: Fact): fact is Extract<Fact, { kind: K }> => fact.kind === kind
}

/** A sense's current gloss is its published one; until one publishes, the pending one under review. */
export function currentGloss(glosses: readonly [FactOf<'sense'>, ...FactOf<'sense'>[]]): FactOf<'sense'> {
  return glosses.find((fact) => fact.status === 'published') ?? glosses[0]
}
