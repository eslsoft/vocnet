import type { EntryId, FactId, FactKind, FactPayloads, FactStatus, Review, SenseId, SentenceId } from '@shared/facts'
import type { SubjectTypeOf } from './fact-kinds'
import type { PrincipalRef } from './principal'

type SubjectIdOf<K extends FactKind> = {
  entry: EntryId
  sense: SenseId
  fact: FactId
  sentence: SentenceId
}[SubjectTypeOf[K]]

export interface FactOf<K extends FactKind> {
  id: FactId
  kind: K
  subjectId: SubjectIdOf<K>
  /** A relation's target sense, an example's sentence; null for other kinds. */
  objectId: SenseId | SentenceId | null
  contentKey: string
  payload: FactPayloads[K]
  status: FactStatus
  supersedesId: FactId | null
  author: PrincipalRef
  review: Review | null
  createdAt: string
  updatedAt: string
}

export type Fact = { [K in FactKind]: FactOf<K> }[FactKind]

export function isKind<K extends FactKind>(kind: K) {
  return (fact: Fact): fact is Extract<Fact, { kind: K }> => fact.kind === kind
}
