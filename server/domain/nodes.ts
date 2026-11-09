import type { EntryId, Pos, SenseId } from '@shared/facts'
import type { PrincipalRef } from './principal'
import type { Lemma } from './term'

export interface EntryNode {
  id: EntryId
  lemma: Lemma
  createdBy: PrincipalRef
  createdAt: string
}

export interface SenseNode {
  id: SenseId
  entryId: EntryId
  pos: Pos
  createdBy: PrincipalRef
  createdAt: string
}

export interface SenseWithLemma extends SenseNode {
  lemma: Lemma
}
